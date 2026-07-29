-- ─────────────────────────────────────────────────────────────────────────────
-- backfill-labour-hours-f1.sql  (Fault Register F1 / Phase B1 backfill)
--
-- ⚠ Run AFTER add-quoteline-labour-hours.sql (+ Function App restart).
--
-- Part 1 — backfill labour_hours on the five health-check casualties
--   (Q260221, Q260618, Q260628, Q260744, Q260745) from each quote's own
--   quote_data blob:
--     fabrication        = $.fabHours
--     approval_fab_pack  = $.fabpackHours + $.structEngHours + $.architectHours
--                          + $.designHours + $.connDesignHours
--     installation       = $.instDays x $.instOperatives x 8
--   (Installation uses the standard crew model; hand-tune any quote that used
--   per-row crew days via the new Hrs column in the line-items editor.)
--
-- Part 2 — reseed Q260221's zero prices: scale its cost_* columns to
--   total_ex_vat with the same category mapping mark-won uses (galvanising
--   folded into painting), rounding remainder onto the largest line.
--
-- Both parts are idempotent: Part 1 only fills NULL hours; Part 2 only runs
-- while the lines still sum to zero.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Part 1: hours backfill ──────────────────────────────────────────────────
;WITH H AS (
    SELECT q.id AS qid,
           TRY_CAST(JSON_VALUE(q.quote_data, '$.fabHours') AS float) AS fab_h,
             ISNULL(TRY_CAST(JSON_VALUE(q.quote_data, '$.fabpackHours')    AS float), 0)
           + ISNULL(TRY_CAST(JSON_VALUE(q.quote_data, '$.structEngHours')  AS float), 0)
           + ISNULL(TRY_CAST(JSON_VALUE(q.quote_data, '$.architectHours')  AS float), 0)
           + ISNULL(TRY_CAST(JSON_VALUE(q.quote_data, '$.designHours')     AS float), 0)
           + ISNULL(TRY_CAST(JSON_VALUE(q.quote_data, '$.connDesignHours') AS float), 0) AS afp_h,
             ISNULL(TRY_CAST(JSON_VALUE(q.quote_data, '$.instDays')        AS float), 0)
           * ISNULL(NULLIF(TRY_CAST(JSON_VALUE(q.quote_data, '$.instOperatives') AS float), 0), 2)
           * 8 AS inst_h
      FROM QuoteBuilderQuotes q
     WHERE q.reference IN ('Q260221','Q260618','Q260628','Q260744','Q260745')
)
UPDATE li
   SET li.labour_hours =
         CASE li.category
           WHEN 'fabrication'       THEN NULLIF(ROUND(H.fab_h, 2), 0)
           WHEN 'approval_fab_pack' THEN NULLIF(ROUND(H.afp_h, 2), 0)
           WHEN 'installation'      THEN NULLIF(ROUND(H.inst_h, 2), 0)
           ELSE li.labour_hours
         END,
       li.updated_at = GETUTCDATE()
  FROM QuoteLineItems li
  JOIN H ON H.qid = li.qb_quote_id
 WHERE li.is_labour = 1
   AND li.labour_hours IS NULL
   AND li.category IN ('fabrication','approval_fab_pack','installation');

PRINT 'Part 1 done — hours backfilled where NULL.';

-- ── Part 2: Q260221 price reseed (lines currently sum to £0) ────────────────
DECLARE @qid INT, @sell DECIMAL(18,2), @sumCost DECIMAL(18,2);
SELECT @qid = id, @sell = total_ex_vat FROM QuoteBuilderQuotes WHERE reference = 'Q260221';

IF @qid IS NOT NULL AND @sell > 0
   AND (SELECT ISNULL(SUM(quantity * unit_price), 0) FROM QuoteLineItems WHERE qb_quote_id = @qid) = 0
BEGIN
    SELECT @sumCost =
          ISNULL(cost_prelims,0) + ISNULL(cost_design,0) + ISNULL(cost_survey,0)
        + ISNULL(cost_material,0) + ISNULL(cost_fabrication,0) + ISNULL(cost_painting,0)
        + ISNULL(cost_installation,0) + ISNULL(cost_delivery,0)
      FROM QuoteBuilderQuotes WHERE id = @qid;

    IF @sumCost > 0
    BEGIN
        UPDATE li
           SET li.unit_price = ROUND(
                 CASE li.category
                   WHEN 'prelims'           THEN ISNULL(q.cost_prelims,0)
                   WHEN 'approval_fab_pack' THEN ISNULL(q.cost_design,0)
                   WHEN 'survey'            THEN ISNULL(q.cost_survey,0)
                   WHEN 'material'          THEN ISNULL(q.cost_material,0)
                   WHEN 'fabrication'       THEN ISNULL(q.cost_fabrication,0)
                   WHEN 'painting'          THEN ISNULL(q.cost_painting,0)
                   WHEN 'galvanising'       THEN 0     -- folded into painting (F5 split lands in B4)
                   WHEN 'installation'      THEN ISNULL(q.cost_installation,0)
                   WHEN 'delivery'          THEN ISNULL(q.cost_delivery,0)
                   ELSE 0
                 END * @sell / @sumCost, 2),
               li.updated_at = GETUTCDATE()
          FROM QuoteLineItems li
          JOIN QuoteBuilderQuotes q ON q.id = li.qb_quote_id
         WHERE li.qb_quote_id = @qid;

        -- Rounding remainder onto the largest line so Σ = total_ex_vat exactly
        DECLARE @drift DECIMAL(18,2);
        SELECT @drift = @sell - ISNULL(SUM(quantity * unit_price), 0)
          FROM QuoteLineItems WHERE qb_quote_id = @qid;
        IF @drift <> 0
            UPDATE QuoteLineItems
               SET unit_price = unit_price + @drift
             WHERE id = (SELECT TOP 1 id FROM QuoteLineItems
                          WHERE qb_quote_id = @qid ORDER BY unit_price DESC, id ASC);
        PRINT 'Part 2 done — Q260221 reseeded to total_ex_vat.';
    END
    ELSE PRINT 'Part 2 skipped — Q260221 has no cost_* base to scale.';
END
ELSE PRINT 'Part 2 skipped — Q260221 lines no longer sum to zero (already fixed?).';

-- Verify:
SELECT q.reference, li.category, li.quantity, li.unit_price, li.labour_hours
  FROM QuoteLineItems li
  JOIN QuoteBuilderQuotes q ON q.id = li.qb_quote_id
 WHERE q.reference IN ('Q260221','Q260618','Q260628','Q260744','Q260745')
 ORDER BY q.reference, li.line_no;
