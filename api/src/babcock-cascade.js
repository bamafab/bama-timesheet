const { query } = require('./db');

// ═══════════════════════════════════════════════════════════════════════════
// BABCOCK PAYMENT CASCADE (Mateusz 2026-08-08)
//
// When Natasza marks money movements in the invoicing ledgers, mirror the
// change onto the Babcock tracker so she doesn't have to record it twice:
//
//   sales  — a sales invoice on a BC project becomes fully Paid
//            ⇒ BabcockQuotes 'Approved to Pay' → 'Payment Received'
//              (+ payment_received_at)
//   bamasw — a Babcock-linked Bama SW supplier invoice is marked paid
//            ⇒ BabcockQuotes 'Payment Received' → 'Paid to Bama SW'
//              (+ bama_sw_paid_at)
//
// STRICT rule: only advance when the tracker sits at the exact prior step.
//   - At/past the target already (or Cancelled/Closed) ⇒ 'noop' — silent.
//   - Earlier in the pipeline ⇒ 'skipped' — the payment still saves, but the
//     caller surfaces a warning toast so the tracker gets manual attention.
//     Force-jumping would skip audit steps (COUPA upload, PO to Bama SW).
//
// ONE-WAY: undoing a payment never rolls the Babcock status back.
// Always call inside try/catch — a cascade failure must never fail the
// payment write itself.
// ═══════════════════════════════════════════════════════════════════════════

// Workflow order — keep in sync with _babcockAdvanceHandlers in shared.js.
const BABCOCK_ORDER = [
    'Quote Received', 'Quote Sent', 'Live Project', 'Project Complete',
    'Bama SW PO Raised', 'Bama SW Invoice Received', 'Approved to Pay',
    'Payment Received', 'Paid to Bama SW', 'Remittance Sent', 'Closed'
];

const CASCADE_KINDS = {
    sales:  { expect: 'Approved to Pay',  target: 'Payment Received', dateCol: 'payment_received_at' },
    bamasw: { expect: 'Payment Received', target: 'Paid to Bama SW',  dateCol: 'bama_sw_paid_at' }
};

// Returns null (no linked quote / unknown kind), or:
//   { action:'advanced', quote_ref, from, to }
//   { action:'skipped',  quote_ref, status, expected, target }
//   { action:'noop',     quote_ref, status }
async function advanceBabcockOnPayment(kind, babcockQuoteId, paymentDate) {
    const spec = CASCADE_KINDS[kind];
    const bqId = parseInt(babcockQuoteId);
    if (!spec || !bqId) return null;

    const res = await query(
        'SELECT id, status, quote_ref FROM BabcockQuotes WHERE id = @id',
        { id: bqId }
    );
    const bq = res.recordset[0];
    if (!bq) return null;

    const curIdx = BABCOCK_ORDER.indexOf(bq.status);
    const tgtIdx = BABCOCK_ORDER.indexOf(spec.target);

    if (bq.status === 'Cancelled' || (curIdx !== -1 && curIdx >= tgtIdx)) {
        return { action: 'noop', quote_ref: bq.quote_ref, status: bq.status };
    }
    if (bq.status !== spec.expect) {
        return {
            action: 'skipped', quote_ref: bq.quote_ref, status: bq.status,
            expected: spec.expect, target: spec.target
        };
    }

    // Date-only strings get a midday time to dodge timezone off-by-one.
    const raw = String(paymentDate || '');
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T12:00:00'
             : (raw || new Date().toISOString());

    await query(
        `UPDATE BabcockQuotes SET status = @st, ${spec.dateCol} = @dt,
                updated_at = GETUTCDATE()
         WHERE id = @id`,
        { id: bq.id, st: spec.target, dt }
    );
    return { action: 'advanced', quote_ref: bq.quote_ref, from: bq.status, to: spec.target };
}

module.exports = { advanceBabcockOnPayment };
