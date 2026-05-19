-- ============================================================
-- BAMA ERP: PO Import fixes — approved_by + line items
-- Run against: bama-erp
-- ============================================================

-- 1. Mark all imported P26 POs as approved & sent (they were already raised/sent historically)
UPDATE dbo.PurchaseOrders
   SET approved_at  = created_at,
       approved_by  = created_by,
       sent_at      = created_at,
       sent_by      = created_by,
       updated_at   = GETUTCDATE()
 WHERE reference LIKE 'P26%'
   AND approved_at IS NULL
   AND status NOT IN ('Cancelled');

PRINT 'Approved_by updated.';

-- 2. LINE ITEMS (items with description and qty/cost from spreadsheet)

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260107' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260107'),
        N'UC 152x152x23,  UC 254x254x89,  Plates', 1.0, 2191.81, 2191.81, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260108' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260108'),
        N'Convex 40 x 12mm x 6.400m, RHS 20x20x2.5', 1.0, 73.5, 73.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260109' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260109'),
        N'Bolts', 1.0, 142.94, 142.94, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260110' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260110'),
        N'Bent Handrail Tube', 2.0, 98.0, 98.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260111' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260111'),
        N'Sending back all the gas cylinders from the site closure', 1.0, 94.95, 94.95, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260112' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260112'),
        N'RHS 200x100x6.3 Hot Finished', 1.0, 370.0, 370.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260113' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260113'),
        N'UC 203x203x60, Flat 300x10', 1.0, 765.3, 765.3, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260114' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260114'),
        N'UB 152x89x16 _ 12m', 1.0, 211.2, 211.2, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260115' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260115'),
        N'bins for the office, bearrings for metal saw, kitchen roll holder', 1.0, 24.21, 24.21, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260116' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260116'),
        N'2x Milwaukee 150mm x 20 Saw Blade', 1.0, 78.0, 78.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260117' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260117'),
        N'office supplies', 1.0, 114.57, 114.57, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260118' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260118'),
        N'Filing Cabinet', 2.0, 353.45, 353.45, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260119' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260119'),
        N'FLT Training for Workshop x 3 people', 1.0, 270.0, 270.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260120' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260120'),
        N'Bolts M16, M20, M12 Threaded rods', 1.0, 89.63, 89.63, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260121' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260121'),
        N'RSA 100x100x10 @ 6.1m', 2.0, 244.0, 244.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260122' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260122'),
        N'139.7od x 10mm Cold formed s355', 1.0, 695.0, 695.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260123' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260123'),
        N'PRONTO 200:026 Primer Light Grey 20L', 1.0, 85.58, 85.58, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260123' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260123'),
        N'PRONTO 003:000 Thinners 25L', 1.0, 88.89, 88.89, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260123' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260123'),
        N'DH Cotton Rags 10KG', 1.0, 17.79, 17.79, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260124' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260124'),
        N'Plates', 1.0, 463.55, 463.55, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260125' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260125'),
        N'Air Compressor Pressure Control Switch with Valve Gauges Regulator', 1.0, 13.32, 13.32, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260126' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260126'),
        N'Bolts', 1.0, 11.83, 11.83, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260127' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260127'),
        N'42.4 x 3 Galv tubes', 11.0, 28.0, 28.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260127' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260127'),
        N'Fittings', 1.0, 270.0, 270.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260128' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260128'),
        N'Fire Rated Downlight', 1.0, 12.95, 12.95, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260129' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260129'),
        N'Jet- Lub V2', 1.0, 12.21, 12.21, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260130' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260130'),
        N'Siamp Spares Skipper 45', 1.0, 9.52, 9.52, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260131' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260131'),
        N'Goldscrew 4 x 40mm Pk200', 1.0, 3.07, 3.07, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260131' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260131'),
        N'Goldscrew 4 x 50mm Pk200', 2.0, 2.92, 2.92, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260131' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260131'),
        N'Square Twist Sheradised Nails 3.75 x 30mm 1kg Pack', 1.0, 4.98, 4.98, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260132' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260132'),
        N'No Nonsense Expanding Foam Gun Grade 750ml', 1.0, 5.21, 5.21, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260133' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260133'),
        N'Stainless steel gas spring 10/250', 2.0, 75.5, 75.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260201' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260201'),
        N'PFC 200 x 90mm 30kg/m x 8.000m', 2.0, 247.0, 247.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260201' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260201'),
        N'UB 178 x 102mm 19kg/m x 4.500m', 1.0, 77.4, 77.4, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260202' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260202'),
        N'Leo Workwear Hawkridge EcoViz', 2.0, 45.7, 45.7, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260202' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260202'),
        N'Dewalt Landers, Dewalt Landers boot', 1.0, 113.3, 113.3, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260204' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260204'),
        N'Drayton Digistat+1 RF Wireless Room Thermostat', 1.0, 75.48, 75.48, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260205' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260205'),
        N'Plates', 1.0, 295.9, 295.9, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260206' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260206'),
        N'SHS 2” x 2” x 10g Aluminium', 2.0, 85.0, 85.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260208' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260208'),
        N'PFC 125 x 65mm 15kg/m x 12.200m', 1.0, 156.57, 156.57, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260208' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260208'),
        N'RSA 100 x 100 x 8mm x 6.400m', 2.0, 65.52, 65.52, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260209' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260209'),
        N'Weld on Drop Bold 300mm', 1.0, 7.2, 7.2, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260210' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260210'),
        N'Bolts', 1.0, 77.21, 77.21, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260211' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260211'),
        N'Bolts', 1.0, 7.7, 7.7, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260212' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260212'),
        N'FLT Checksheets', 2.0, 3.97, 3.97, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260212' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260212'),
        N'Drayton Thermostat', 1.0, 91.99, 91.99, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260213' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260213'),
        N'BLU, Offset Round ''T'' Bar Handle for Straight Slide Doors', 4.0, 146.06, 146.06, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260214' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260214'),
        N'M12x120 Bolts + NW', 1.0, 7.7, 7.7, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260215' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260215'),
        N'Galvanising Folded Cover Plates', NULL, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260216' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260216'),
        N'M12 GALV Bolts + NW', 1.0, 2.03, 2.03, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260217' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260217'),
        N'Light Angle 80 x 80 x 6mm x 6.400m', 1.0, 49.35, 49.35, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260217' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260217'),
        N'Heavy Angle 100 x 100 x 8mm x 6.400m', 1.0, 76.83, 76.83, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260217' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260217'),
        N'Heavy Angle 100 x 65 x 10mm x 6.400m', 1.0, 76.24, 76.24, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260218' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260218'),
        N'MOT Service', 1.0, 286.04, 286.04, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260219' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260219'),
        N'Office Chair', 1.0, 141.66, 141.66, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260220' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260220'),
        N'RHS 150x100x6', 3.0, 153.55, 153.55, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260220' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260220'),
        N'RHS 60x60x5', 6.0, 51.94, 51.94, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260220' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260220'),
        N'RHS 100x100x6', 3.0, 111.1, 111.1, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260220' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260220'),
        N'FLT 60x8', 4.0, 20.0, 20.0, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'UB178 x 102 x 19Kg @ 6.1m', 1.0, 92.8, 92.8, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'UB254 x 146 x 31Kg @ 13m', 1.0, 323.2, 323.2, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'UB254 x 146 x 31Kg @ 8m', 1.0, 199.2, 199.2, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'UB152 x 89 x 16Kg @ 6.1m', 1.0, 78.4, 78.4, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'S.H.S. 100 x 100 x 6.0mm @ 7.5m', 1.0, 129.0, 129.0, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'UC 203 x 203 x 86.1Kg @ 6.1m', 1.0, 420.0, 420.0, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'UC203 x 203 x 52kg @ 6.1m', 1.0, 253.6, 253.6, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'FLT15 x 200 @ 6.1m', 1.0, 122.4, 122.4, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260221' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260221'),
        N'Shotblasting & Primer Painted RED', 1.0, 100.0, 100.0, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260222' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260222'),
        N'Plates', 1.0, 157.69, 157.69, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260223' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260223'),
        N'RHS150*100*6 @ 7.5m', 1.0, 170.0, 170.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260225' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260225'),
        N'Locinox Mammoth Gate Closer - Silver', 2.0, 262.5, 262.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260225' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260225'),
        N'Screw Fix Drop Bar 300mm - Galvanised', 3.0, 8.0, 8.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260225' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260225'),
        N'Locinox Sixty Lock Kit', 1.0, 69.0, 69.0, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260226' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260226'),
        N'XOX Bolts, Hollo Bolts, Threaded bars', 1.0, 716.99, 716.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260227' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260227'),
        N'M20 bolts, M12 Bolts', 1.0, 31.53, 31.53, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260228' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260228'),
        N'M20 bolts, M12 Bolts', 1.0, 99.22, 99.22, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260229' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260229'),
        N'Locinox Sixty Lock Kit', 1.0, 69.0, 69.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260230' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260230'),
        N'Stapler remover', 1.0, 4.99, 4.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260230' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260230'),
        N'filing tray spikes', 12.0, 0.99, 0.99, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260231' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260231'),
        N'Disposable Overall', 1.0, 28.0, 28.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260231' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260231'),
        N'Box 20 Face Mask', 1.0, 44.0, 44.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260232' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260232'),
        N'Premium Masking film', 1.0, 25.9, 25.9, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260232' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260232'),
        N'Wet Dry Sheet', 1.0, 4.75, 4.75, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260233' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260233'),
        N'500mmx25m Carpet Protector', 1.0, 20.83, 20.83, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260233' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260233'),
        N'Copper Tube 15mm x 2m EACH', 1.0, 7.52, 7.52, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260234' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260234'),
        N'No Nonsense Beige Masking Tape 50m x 24mm', 1.0, 7.6, 7.6, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260234' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260234'),
        N'No Nonsense FineDELICATE Washi Mask Tape 41mx24mm', 1.0, 4.16, 4.16, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260235' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260235'),
        N'Extra Strong Rubble Sack', 1.0, 6.66, 6.66, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260236' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260236'),
        N'DT QUICK DRY UNDERCOAT WHITE 1L', 1.0, 19.99, 19.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260236' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260236'),
        N'Ronseal High Performance Wood Filler 1Kg White', 1.0, 20.41, 20.41, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260237' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260237'),
        N'Sanding Sheet', 1.0, 12.067, 12.067, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260237' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260237'),
        N'Pencil Site Holster', 1.0, 5.82, 5.82, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260238' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260238'),
        N'Remote IT support', 1.0, 50.0, 50.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260239' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260239'),
        N'LIONWELD KENNEDY - SAFEGRID 35BP 50X5 5MM SERRATED', 12.0, 615.0, 615.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260239' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260239'),
        N'FLT5*50 Serrated', 6.0, 38.0, 38.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260240' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260240'),
        N'Parallel Channel 200 x 75 x 23', 4.0, 40.5, 40.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260240' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260240'),
        N'Universal Beam 457 x 191 x 89Kg', 9.0, 244.2222, 244.2222, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260240' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260240'),
        N'Universal Beam 356 x 127 x 33K', 15.0, 107.6667, 107.6667, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260240' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260240'),
        N'Drilling & Cutting Charge', 1.0, 450.0, 450.0, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260240' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260240'),
        N'Equal Angle 60 x 60 x 5mm', 3.0, 8.3333, 8.3333, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260240' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260240'),
        N'Universal Beam 356 x 127 x 33Kg', 9.0, 55.8889, 55.8889, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260240' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260240'),
        N'Cutting Charge', 1.0, 80.0, 80.0, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260241' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260241'),
        N'35/50 Key Cylinder', 2.0, 11.66, 11.66, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260242' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260242'),
        N'10313/3010 3010 x 27 x 0.9mm - GoldCut 424™ Bandsaw Blade', 10.0, 25.59, 25.59, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260243' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260243'),
        N'6/10 VP', NULL, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260245' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260245'),
        N'PFC200*90*30', 1.0, 214.2, 214.2, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260245' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260245'),
        N'SHS90*90*5', 1.0, 100.0, 100.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260246' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260246'),
        N'Plates', 1.0, 775.04, 775.04, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260247' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260247'),
        N'Sanding Disc', 1.0, 7.07, 7.07, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260248' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260248'),
        N'Door Stop', 1.0, 9.0, 9.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260248' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260248'),
        N'Wood Dye', 1.0, 11.67, 11.67, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260248' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260248'),
        N'Brush, Paint Scruttle', 1.0, 3.5, 3.5, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260249' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260249'),
        N'Sketchers Safety Shoes (Jay)', 1.0, 73.5, 73.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260301' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260301'),
        N'Pronto 200 Primer Dark Grey 5L', 1.0, 19.7, 19.7, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260302' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260302'),
        N'Burnsuthe sachet', 1.0, 6.5, 6.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260303' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260303'),
        N'Dell WD19 Dock', 1.0, 75.2, 75.2, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260304' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260304'),
        N'Self closing sprung gate hinge set', 2.0, 14.99, 14.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260305' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260305'),
        N'Vernal Desk Panel', 1.0, 79.99, 79.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260306' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260306'),
        N'Galvanised Infill Panel', 44.0, 13.7, 13.7, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260306' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260306'),
        N'1830 x 915mm 2"x 2"x 10g', 4.0, 14.8, 14.8, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260306' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260306'),
        N'Single Slide Latch kit', 1.0, 12.1, 12.1, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260307' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260307'),
        N'Universal Beam 203 x 102mm 23kg/m', 1.0, 170.2, 170.2, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260307' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260307'),
        N'Light Rounds 8mm x 6.400m', 9.0, 3.45, 3.45, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260307' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260307'),
        N'Cold Formed Circular Hollow Section 42.4 x 3mm x 7.650m', 13.0, 19.9, 19.9, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260307' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260307'),
        N'Universal Beam 178 x 102mm 19kg/m x 8.900m', 1.0, 152.1, 152.1, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 170C', 80.0, 0.92, 0.92, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 171C', 150.0, 1.15, 1.15, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 125C', 10.0, 3.19, 3.19, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 101C', 30.0, 2.78, 2.78, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 116C', 4.0, 3.38, 3.38, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 128C', 4.0, 4.2, 4.2, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 156C', 6.0, 4.65, 4.65, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 277C', 6.0, 11.97, 11.97, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260308' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260308'),
        N'Kee Clamp 119C', 28.0, 3.42, 3.42, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260309' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260309'),
        N'Hard hat and gloves', 2.0, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260309' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260309'),
        N'gloves', 1.0, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260310' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260310'),
        N'Toilet Paper', 2.0, 14.49, 14.49, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260311' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260311'),
        N'Certification/Management Fee For The Period, 01.05.2026 to 30.04.2027', 1.0, 1213.0, 1213.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260312' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260312'),
        N'Plates', 1.0, 218.27, 218.27, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260313' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260313'),
        N'M24, M20, M12 Bolts + NW', 1.0, 155.0, 155.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260314' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260314'),
        N'Safety Shoes - Daniel', 1.0, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260315' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260315'),
        N'AS-90 Anti Spatter', 15.0, 4.35, 4.35, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260315' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260315'),
        N'CT-90 Bottle', 2.0, 11.02, 11.02, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260315' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260315'),
        N'CT-90 Spray', 1.0, 7.92, 7.92, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260316' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260316'),
        N'20ltr Dark Grey QD Pronto Paint', 4.0, 72.35, 72.35, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260317' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260317'),
        N'Kärcher SC 3 EasyFix Steam Cleaner, 1900W, 3.5 bar,', 1.0, 125.0, 125.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260318' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260318'),
        N'Genuine Binzel MB36 M8 Adapter', 1.0, 10.6, 10.6, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260319' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260319'),
        N'Bolts', 1.0, 28.46, 28.46, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260320' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260320'),
        N'Light Angle 80 x 80 x 6mm x 6.400m', 1.0, 70.5, 70.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260321' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260321'),
        N'BOC SUPER-THIN INOX DISC 9" X 1.9MM', 25.0, 1.49, 1.49, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260322' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260322'),
        N'Plates', 4.0, 58.8925, 58.8925, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260323' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260323'),
        N'280mm recip blade', 1.0, 10.94, 10.94, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260323' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260323'),
        N'180mm recip blad', 1.0, 18.01, 18.01, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260323' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260323'),
        N'130mm recip blad', 1.0, 20.24, 20.24, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260324' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260324'),
        N'Hammerite 750ml Red Metal Primer Undercoat', 1.0, 18.33, 18.33, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260325' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260325'),
        N'Koko Unsweetened No Sugar Mlk 12 x 1', 1.0, 19.95, 19.95, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260325' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260325'),
        N'Regina Absorb Kitchen Towels – 8 Roll', 1.0, 8.33, 8.33, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260326' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260326'),
        N'Pallet delivery', 1.0, 63.93, 63.93, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260327' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260327'),
        N'Laser Cut Plates', 1.0, 612.02, 612.02, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260328' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260328'),
        N'PHOENIX 230MM X 1.8MM "BLACK EDITION', 25.0, 1.76, 1.76, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260329' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260329'),
        N'Flooring Clips 41/100 + 30/100 (FD600)', 40.0, 1.2, 1.2, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260330' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260330'),
        N'Light Flats 150x6', 1.0, 69.85, 69.85, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260330' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260330'),
        N'Open Mesh Flooring Panel', 1.0, 325.0, 325.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260331' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260331'),
        N'7.7t of steel for galvanising', 1.0, 4158.0, 4158.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Universal Beam 356 x 171 x 67kg', 6.0, 147.3333, 147.3333, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Universal Beam 254 x 146 x 37Kg', 20.0, 145.65, 145.65, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Universal Beam 254 x 146 x 31Kg', 8.0, 141.25, 141.25, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Universal Beam 254 x 102 x 22Kg', 6.0, 110.3333, 110.3333, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Universal Beam 203 x 133 x 30Kg', 3.0, 68.6667, 68.6667, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Universal Beam 203 x 133 x 25Kg', 25.0, 86.4, 86.4, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Universal Beam 203 x 102 x 23Kg', 1.0, 120.0, 120.0, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Drilling & Cutting Charge', 1.0, 825.0, 825.0, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'SKEW Cutting', 1.0, 32.0, 32.0, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260333' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260333'),
        N'Shotblasting & Primer Painted RED', 1.0, 495.0, 495.0, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260334' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260334'),
        N'AA batteries', 1.0, 8.99, 8.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260335' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260335'),
        N'Gas 18 kg', 2.0, 35.0, 35.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260336' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260336'),
        N'Coffe for the office', 1.0, 155.92, 155.92, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260337' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260337'),
        N'WHEEL, ROLLER, NYLATRON, 1.75', 10.0, 7.43, 7.43, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260337' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260337'),
        N'BOLT, ROLLER, NYLATRON, 1.75', 10.0, 6.52, 6.52, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260338' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260338'),
        N'Cold Formed Circular Hollow Section 21.3 x 3mm', 2.0, 21.0, 21.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260340' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260340'),
        N'Plates', 1.0, 3304.34, 3304.34, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'COLD RHS 120 X 80 X 10MM', 11.0, 72.2727, 72.2727, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'*HOT* RHS 160 X 80 X 6.3MM', 9.0, 130.5556, 130.5556, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'*HOT* RHS 200 X 100 X 8MM', 15.0, 185.3333, 185.3333, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'COLD RHS 250 X 100 X 10MM', 3.0, 483.0, 483.0, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'COLD RHS 250 X 150 X 10MM', 5.0, 311.6, 311.6, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'COLD RHS 250 X 150 X 8MM', 4.0, 263.75, 263.75, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'COLD SHS 120 X 120 X 10MM', 5.0, 170.0, 170.0, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'*HOT* SHS 150 X 150 X 6.3MM', 22.0, 170.6818, 170.6818, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'*HOT* CHS 139.7 X 8MM', 1.0, 285.0, 285.0, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'COLD RHS 160 X 80 X 10MM', 1.0, 375.0, 375.0, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260341' AND li.sort_order = 10
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260341'),
        N'COLD SHS 90 X 90 X 5MM', 1.0, 108.0, 108.0, 10;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260342' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260342'),
        N'RHS 50x50x2.5', 3.0, 34.0, 34.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260343' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260343'),
        N'Light Round 16mm Bars', 9.0, 12.0, 12.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260344' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260344'),
        N'Rolled RHS 200x100x8', 2.0, 956.0, 956.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260345' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260345'),
        N'Set of laser cut 25mm S275 profiles', 1.0, 1654.62, 1654.62, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260346' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260346'),
        N'Oxygen size W', 1.0, 12.37, 12.37, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260346' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260346'),
        N'Argoshield Universal W', 3.0, 18.83, 18.83, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260346' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260346'),
        N'Enviroment & Energy surcharge', 1.0, 3.07, 3.07, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260346' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260346'),
        N'Enviroment & Energy surcharge', 1.0, 7.62, 7.62, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260346' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260346'),
        N'Fixed Charge', 1.0, 97.95, 97.95, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260346' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260346'),
        N'Rental', 1.0, 147.25, 147.25, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Equal Angle 90 x 90 x 10mm', 3.0, 52.0, 52.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Unequal Angle 200 x 100 x 10mm', 3.0, 71.0, 71.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Unequal Angle 125 x 75 x 10mm', 16.0, 5.75, 5.75, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Unequal Angle 100 x 75 x 10mm', 4.0, 19.75, 19.75, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Parallel Channel 200 x 90 x 30 **', 4.0, 99.5, 99.5, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Universal Column 203 x 203 x 46.1Kg', 22.0, 135.9091, 135.9091, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Universal Column 203 x 203 x 46.1Kg', 4.0, 280.75, 280.75, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Universal Column 152 x 152 x 30kg', 8.0, 85.75, 85.75, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Drilling & Cutting Charge', 1.0, 450.0, 450.0, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'SKEW Cutting Included ** PLS NOTE **', 1.0, 48.0, 48.0, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 10
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Milling Charge', 1.0, 100.0, 100.0, 10;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260347' AND li.sort_order = 11
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260347'),
        N'Shear and Punch Charge EXC 2 Only', 1.0, 50.0, 50.0, 11;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260348' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260348'),
        N'BOLTS, STUDDING, RESIN', 1.0, 1100.88, 1100.88, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260349' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260349'),
        N'Stick Well A4 Printer Paper - 2500 Sheets', 1.0, 14.99, 14.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260349' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260349'),
        N'Xerox Performer A3 80gsm Pack 500 Sheets', 1.0, 10.25, 10.25, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260350' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260350'),
        N'Vertical Access Ladder 3900 - 4300mm Capacity', 1.0, 1236.3, 1236.3, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260350' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260350'),
        N'Lower Hoop - Dia 700x750mm', 1.0, 50.5, 50.5, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260351' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260351'),
        N'ADJUSTABLE GATE EYE 16MM PIN 6" LONG', 3.0, 3.11, 3.11, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260351' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260351'),
        N'GATE PIN TO WELD 16MM', 3.0, 3.45, 3.45, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'PREDATOR TWARON® MIG GAUNTLET BLUE SIZE 11', 5.0, 4.65, 4.65, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'BÖHLER QG3 SG2 1.0MM X 15KG MIG WIRE', 6.0, 23.5, 23.5, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'TYROLIT 115 X 1.0MM 1 STAR DISC', 50.0, 0.61, 0.61, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'3M™ SPEEDGLAS™ 9100 OUTER PROTECTION PLATE (10)', 2.0, 26.5, 26.5, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'GENUINE BINZEL MB36 GAS DIFFUSER BLACK', 20.0, 0.8, 0.8, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'FRENCH CHALK 127X13X5 (144 PCS)', 1.0, 8.95, 8.95, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'BOSCH GWS9-115S 4.5" GRINDER 110V', 1.0, 82.5, 82.5, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260401' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260401'),
        N'Serial no. 525076731', NULL, NULL, NULL, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260402' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260402'),
        N'4.5mm O/P folded durbar treads', 2.0, 60.0, 60.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260403' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260403'),
        N'10mm Laser Cut Plates', 15.0, 8.6667, 8.6667, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260403' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260403'),
        N'80 x 80 x 5mm CF S355 – 1no 7.5mtr stock bar', 1.0, 135.0, 135.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260404' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260404'),
        N'Manitou 200ATJ (60D017) 16-17.04.26', 1.0, 315.0, 315.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260404' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260404'),
        N'Fuel', 1.0, 27.12, 27.12, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260405' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260405'),
        N'Laser Cutting (Galv Sheets)', 10.0, 23.466, 23.466, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260406' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260406'),
        N'Durbar Plate (Mild Tread)', 1.0, 85.34, 85.34, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260407' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260407'),
        N'Mild Steel Flat 100 x 10mm', 1.0, 44.64, 44.64, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260407' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260407'),
        N'Mild Steel Flat 150 x 15mm', 15.0, 100.19, 100.19, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'810 x 535 x 8mm Durbar', 1.0, 64.39, 64.39, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'550 x 550 x 8mm Durbar', 1.0, 49.5, 49.5, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'715 x 615 x 8mm Durbar', 1.0, 65.07, 65.07, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'790 x 290 x 8mm Durbar', 1.0, 41.34, 41.34, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'1060 x 615 x 8mm Durbar', 1.0, 89.12, 89.12, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'730 x 420 x 8mm Durbar', 1.0, 50.04, 50.04, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'1460 x 405 x 8mm Durbar', 2.0, 81.66, 81.66, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'12 x 690 x 1240mm Durbar', 2.0, 405.25, 405.25, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'20 x 330 x 990mm S275 Mild Steel Plate', 1.0, 128.94, 128.94, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'10 x 120 x 1240mm Durbar', 1.0, 88.16, 88.16, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260408' AND li.sort_order = 10
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260408'),
        N'10 x 1075 x 615mm Durbar', 1.0, 304.62, 304.62, 10;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260409' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260409'),
        N'Faith In Nature Natural Coconut Hand & Body Lotion,', 1.0, 30.33, 30.33, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260409' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260409'),
        N'Faith In Nature Natural Lavender and Geranium Liquid Hand Wash', 1.0, 24.92, 24.92, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260410' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260410'),
        N'Mild Steel Round 10mm Diameter', 1.0, 6.0, 6.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260410' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260410'),
        N'Cold Formed C.H.S. 60.3 x 5.0mm', 8.0, 14.75, 14.75, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260410' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260410'),
        N'C.H.S. 48.3 x 5.0mm', 8.0, 6.0, 6.0, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260410' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260410'),
        N'Cutting Charge', 1.0, 50.0, 50.0, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260410' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260410'),
        N'Plasma/Laser cut plate 10mm S275JR', 16.0, 6.25, 6.25, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260411' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260411'),
        N'EN10255 Tubing 32mm N/B (42.4 O/D)', 15.0, 30.0, 30.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260412' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260412'),
        N'Flooring Clips 41/100 + 30/100 (FD600)', 280.0, 1.2, 1.2, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260413' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260413'),
        N'Tower Scaffold with 7.5m working height', 2.0, 135.56, 135.56, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260413' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260413'),
        N'PER WEEK', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260414' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260414'),
        N'5L Thinners', 2.0, 17.54, 17.54, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260414' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260414'),
        N'25L Thinners', 2.0, 80.0, 80.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260414' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260414'),
        N'20L Pronto Paints Dark Grey', 4.0, 75.0, 75.0, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260415' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260415'),
        N'Hammerite Direct to Metal Paint Smooth Yellow 750ml', 1.0, 20.68, 20.68, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260416' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260416'),
        N'Printing of 8 no. drawings in A1 size', 1.0, 48.0, 48.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260417' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260417'),
        N'Heavy Duty Shrink Wrap Roll Cling Film Packaging 400MM x 250M', 6.0, 3.54, 3.54, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260418' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260418'),
        N'32mm heavy screws', 100.0, 0.144, 0.144, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260418' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260418'),
        N'Gate latch', 1.0, 4.2, 4.2, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260418' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260418'),
        N'310 Resin', 1.0, 6.95, 6.95, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260419' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260419'),
        N'2t Intermediate Gantry c/w 4.57m Beam & Trolley', 2.0, 215.0, 215.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260419' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260419'),
        N'PER WEEK', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260419' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260419'),
        N'2t 3m Chain Block', 2.0, 31.0, 31.0, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260419' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260419'),
        N'PER WEEK', NULL, NULL, NULL, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260420' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260420'),
        N'Hard hat', 2.0, 14.68, 14.68, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260420' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260420'),
        N'Ear defender', 2.0, 24.15, 24.15, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260420' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260420'),
        N'Chin straps', 2.0, 8.93, 8.93, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260420' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260420'),
        N'Head torch', 2.0, 8.68, 8.68, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260421' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260421'),
        N'Portwest BIZ5 Bizweld FR Men''s Coverall Flame Resistant Welding Overall', 1.0, 64.17, 64.17, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260422' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260422'),
        N'Unequal Angle 200 x 100 x 10mm', 1.0, 428.53, 428.53, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260423' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260423'),
        N'Creditsafe Subscription for a year', 1.0, 600.0, 600.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Cold Formed S.H.S. 70 x 70 x 5.0mm', 2.0, 43.0, 43.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Cold Formed S.H.S. 70 x 70 x 5.0mm', 4.0, 43.75, 43.75, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Mild Steel Flat 100 x 8mm', 4.0, 36.25, 36.25, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Universal Beam 254 x 146 x 31Kg', 1.0, 186.0, 186.0, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Universal Beam 152 x 89 x 16Kg', 3.0, 73.3333, 73.3333, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Universal Beam 152 x 89 x 16Kg', 3.0, 49.6667, 49.6667, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Universal Column 152 x 152 x 23kg', 6.0, 71.3333, 71.3333, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Universal Column 152 x 152 x 23kg', 1.0, 95.0, 95.0, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Drilling & Cutting Charge', 1.0, 255.0, 255.0, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'SKEW Cutting Include', 1.0, 8.0, 8.0, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 10
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Fabrication to clients specification', 1.0, 120.0, 120.0, 10;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260424' AND li.sort_order = 11
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260424'),
        N'Cold Formed C.H.S. 114.3 x 5.0mm', 3.0, 90.6667, 90.6667, 11;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260425' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260425'),
        N'Plates', 1.0, 693.7, 693.7, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260426' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260426'),
        N'Z60 Cherry Picker', 1.0, 350.0, 350.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260426' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260426'),
        N'PER WEEK', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260427' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260427'),
        N'NiPoGi P2 Mini PC AMD Ryzen 4300U', 1.0, 166.66, 166.66, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260427' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260427'),
        N'Apple iPad 11-inch: A16 chip, 11-inch Model', 1.0, 338.31, 338.31, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260427' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260427'),
        N'Apple iPad 11-inch: A16 chip, 11-inch Model, Liquid Retina Display', 1.0, 337.47, 337.47, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260428' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260428'),
        N'Scissor lift 3219', 2.0, 95.0, 95.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260428' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260428'),
        N'PER WEEK', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260429' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260429'),
        N'Regina XXL Absorb Kitchen Towels – 16 Rolls', 1.0, 16.66, 16.66, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260430' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260430'),
        N'18 mm SDS Max Drill Bit', 2.0, 33.17, 33.17, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'EAVESBEAM/FF S450 Galv EB Flat Face 19020 4794mm EB1 / EB2', 2.0, 61.5, 61.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 4407mm P1', 8.0, 39.5, 39.5, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 4407mm P2', 3.0, 39.97, 39.97, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 4615mm P3', 3.0, 40.63, 40.63, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 1213mm P4', 2.0, 15.51, 15.51, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 1999mm P5', 2.0, 19.98, 19.98, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 1649mm P6', 2.0, 13.24, 13.24, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 2087mm P7', 2.0, 19.98, 19.98, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 1737mm P8', 2.0, 19.98, 19.98, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 3073mm P9', 3.0, 29.97, 29.97, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 10
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'P17725 S450 Galv 17725 Zed Purlin 2901mm P10', 3.0, 30.02, 30.02, 10;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260431' AND li.sort_order = 11
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260431'),
        N'S450 Galv 17725 Zed Purlin 548mm P11', 2.0, 9.98, 9.98, 11;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260432' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260432'),
        N'Genie Lift SL-15', 1.0, 115.06, 115.06, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260432' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260432'),
        N'PER WEEK', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260432' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260432'),
        N'Extension Forks', 1.0, 16.663, 16.663, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260432' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260432'),
        N'PER WEEK', NULL, NULL, NULL, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260433' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260433'),
        N'1t Pack away Floor Crane', 1.0, 68.0, 68.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260433' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260433'),
        N'PER WEEK', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260434' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260434'),
        N'2.5t of steel members to be galvanised', 1.0, 1431.0, 1431.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260435' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260435'),
        N'75*50 Galv bracket', 8.0, 0.72, 0.72, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'AURELIA® VIBRANT® NATURAL LATEX GLOVE PF (100) LARGE', 2.0, 4.0, 4.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'AURELIA® VIBRANT® NATURAL LATEX GLOVE PF (100) XL', 2.0, 4.0, 4.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'VULCAN 115MM X 6.4MM DC T27 GRINDING', 30.0, 1.3, 1.3, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'TYROLIT 115 X 1.0MM 1 STAR DISC', 50.0, 0.61, 0.61, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'PHOENIX 230MM X 1.8MM "BLACK EDITION"', 25.0, 1.85, 1.85, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'VULCAN 230MM X 6.4MM DC T27 GRINDING', 10.0, 3.5, 3.5, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'BÖHLER QG3 SG2 1.0MM X 15KG MIG WIRE', 5.0, 23.5, 23.5, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'PREDATOR TWARON® MIG GAUNTLET BLUE SIZE 11', 5.0, 4.65, 4.65, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'TYGRIS R224 BRIGHT ZINC GALV SPRAY 400ML CAN', 12.0, 5.75, 5.75, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260436' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260436'),
        N'ACTION CAN CT-90 CUTTING & TAPPING TWIN SPRAY 500ML', 2.0, 7.92, 7.92, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260437' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260437'),
        N'GoSystem Auto Start Blow Torch', 1.0, 24.99, 24.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260437' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260437'),
        N'Soudal Trade Multi Purpose Silicone', 1.0, 3.59, 3.59, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260437' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260437'),
        N'Cold Galvanising Spray Paint 400ml', 1.0, 5.57, 5.57, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M16 X 110 BS EN 15048', 10.0, 0.331, 0.331, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M16 X 55 BS EN 15048', 18.0, 0.2117, 0.2117, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M16 X 45 BS EN 15048', 95.0, 0.1997, 0.1997, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M16 X 40 BS EN 15048', 310.0, 0.196, 0.196, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M12 X 40 BS EN 15048', 10.0, 0.1, 0.1, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M16 X 150 STUDDING 8.8 GALV', 44.0, 0.89, 0.89, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M16 FORM A WASHER', 44.0, 0.0193, 0.0193, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260438' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260438'),
        N'M16 HEXAGON NUT', 44.0, 0.0489, 0.0489, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260439' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260439'),
        N'M8x100 bolts for grating clips', 150.0, 0.2235, 0.2235, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260440' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260440'),
        N'Oxygen gas size W', 2.0, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260440' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260440'),
        N'12% MIX Gas', 3.0, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260441' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260441'),
        N'Various of Kee Klamp Fittings', 1.0, 118.88, 118.88, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260442' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260442'),
        N'Galvanised steel for Coop', 1.0, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260443' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260443'),
        N'Mi-Tower', 2.0, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260443' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260443'),
        N'PER WEEK', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260444' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260444'),
        N'Kee Klamp Mesh Clips', 100.0, 1.0625, 1.0625, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260445' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260445'),
        N'Koko Unsweetened No Sugar Mlk 12 x 1L', 1.0, 19.95, 19.95, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260446' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260446'),
        N'HP 230 Wireless Keyboard and Mouse Combo Set', 1.0, 12.99, 12.99, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260447' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260447'),
        N'B0076', 1.0, 8591.0, 8591.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260447' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260447'),
        N'Materials', 1.0, -1027.6, -1027.6, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260448' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260448'),
        N'B0077', 1.0, 5857.0, 5857.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260448' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260448'),
        N'Materials', 1.0, -522.78, -522.78, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260449' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260449'),
        N'B0084', 1.0, 1173.0, 1173.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260501' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260501'),
        N'O.S.F. Stairtread 41/100 1000 x 247mm', 7.0, 47.8, 47.8, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260501' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260501'),
        N'42.4mm In-line Swivel Fitting', 4.0, 8.3, 8.3, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260502' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260502'),
        N'Cold Formed S.H.S. 80 x 80 x 5.0mm', 1.0, 141.0, 141.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260503' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260503'),
        N'B0035', 1.0, 4545.45, 4545.45, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260504' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260504'),
        N'B0082', 1.0, 894.0, 894.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260505' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260505'),
        N'Parallel Channel 200 x 75 x 23 **', 1.0, 225.0, 225.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260506' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260506'),
        N'Labour Simon Batstone', 0.5, 65.0, 65.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260506' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260506'),
        N'2 CORE 1.0MM H05VV-F GREY CABLE PER MTR', 6.0, 2.63, 2.63, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260506' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260506'),
        N'16A 110V YELLOW PLUG EP4001', 2.0, 5.95, 5.95, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260506' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260506'),
        N'GROMMET', 1.0, 2.25, 2.25, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260506' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260506'),
        N'PAT TEST SIMON BATSTONE', 3.0, 2.65, 2.65, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'BG Storm Weatherproof 1G Switch Matt Black', 1.0, 8.32, 8.32, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'BG Storm Weatherproof 2G Switch Matt Black', 1.0, 12.49, 12.49, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Stop Cock with Reduced Bore, PN 10, size 22mmx25mm', 1.0, 8.74, 8.74, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Copper Tube 15mm x 2m EACH', 1.0, 7.82, 7.82, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Copper Tube 22mm x 2m EACH', 1.0, 16.15, 16.15, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 5
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'EndfeedReduced Tee 22 x 22 x 15mm', 1.0, 7.72, 7.72, 5;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 6
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Equal Tee 15mm Pack of 10', 1.0, 5.83, 5.83, 6;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 7
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Reducing Coupler 22 x 15mm Pack of 10', 1.0, 10.07, 10.07, 7;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 8
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Straight Coupling 22mm Pack of 10', 1.0, 4.97, 4.97, 8;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 9
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Fernox Hawk White Jointing Compound 400g', 1.0, 6.82, 6.82, 9;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 10
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'FloPlast Half Round Bracket Black PK10', 1.0, 7.82, 7.82, 10;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260507' AND li.sort_order = 11
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260507'),
        N'Galvanised Felt Nails 3 x 20mm 0.5kg Pack', 1.0, 3.32, 3.32, 11;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260508' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260508'),
        N'15mm Full Bore Isolating Valve', 1.0, 11.83, 11.83, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260508' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260508'),
        N'No Nonsense Beige Masking tape 50Mx48mm Single', 1.0, 3.07, 3.07, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260509' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260509'),
        N'B&Q CONN STRIP HIGH TEMP 12W 15A PK5 BLK', 1.0, 6.67, 6.67, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260509' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260509'),
        N'FLEX CABLE 3183Y 3 CORE 1.5MM X 25M', 1.0, 27.65, 27.65, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260509' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260509'),
        N'MIXED BLACK HEAT SHRINK SLEEVE 15PC', 1.0, 1.57, 1.57, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260510' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260510'),
        N'Remove and replace 8 chained damaged stanchion posts, consisting of two sections each and then reattach the chain. No painting required.', 1.0, 4860.0, 4860.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260511' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260511'),
        N'600 x 600 x 25mm Plate', 2.0, 118.75, 118.75, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260512' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260512'),
        N'Universal Column 203 x 203 x 71kg', 1.0, 6984.0, 6984.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260512' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260512'),
        N'16 @ Bars 4.200 Metre', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260512' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260512'),
        N'4 @ Bars 3.900 Metre', NULL, NULL, NULL, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260512' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260512'),
        N'3 @ Bars 3.600 Metre', NULL, NULL, NULL, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260513' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260513'),
        N'Jasic 450A', 1.0, 2100.0, 2100.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260515' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260515'),
        N'40t mobile crane for duration of 2 days', 2.0, 1780.0, 1780.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260516' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260516'),
        N'HIAB delivery and off-loading on-site', 1.0, 700.0, 700.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260517' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260517'),
        N'Metal gate to be fixed and be able to be locked, minor on-site fabrication and repairs.', 1.0, 1173.0, 1173.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260518' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260518'),
        N'Oxygen gas size W', NULL, NULL, NULL, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260520' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260520'),
        N'Load 1 - Wednesday 13/5/26 - Collection Yaxley - 6am', 1.0, 702.0, 702.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260520' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260520'),
        N'Load 2 - Thursday 14/5/26 - Collection Yaxley - 6am', 1.0, 702.0, 702.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260520' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260520'),
        N'Load 3 - Friday 15/5/26 - Collection Yaxley - 6am', 1.0, 702.0, 702.0, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260520' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260520'),
        N'All to be delivered to:', NULL, NULL, NULL, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260520' AND li.sort_order = 4
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260520'),
        N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', NULL, NULL, NULL, 4;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260521' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260521'),
        N'Generic Support', 1.0, 90.0, 90.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260521' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260521'),
        N'Graitec PowerPack For Advance Steel', 1.0, 800.0, 800.0, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260522' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260522'),
        N'Advance Steel 1 Year Subscription', 1.0, 1955.0, 1955.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260522' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260522'),
        N'VAT Exempt', NULL, NULL, NULL, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260523' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260523'),
        N'1.0MM X 15KG MIG WIRE', 5.0, 23.5, 23.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260523' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260523'),
        N'ACTION CAN AS-90 ANTI-SPATTER 400G', 15.0, 4.35, 4.35, 1;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260523' AND li.sort_order = 2
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260523'),
        N'TAF CIP47Z 115MM X 40G FLAPDISC', 40.0, 1.48, 1.48, 2;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260523' AND li.sort_order = 3
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260523'),
        N'115MMXP36 FIBRE DISC (25)', 2.0, 45.39, 45.39, 3;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260524' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260524'),
        N'60t mobile crane for duration of 2 days', 2.0, 1980.0, 1980.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260525' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260525'),
        N'B0074', 1.0, 9932.0, 9932.0, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260526' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260526'),
        N'8.8XOX BZP M16 X 200 complete with nuts and washers', 200.0, 1.5, 1.5, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260527' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260527'),
        N'VILLCASE 2pcs Compression Latch Lock', 7.0, 18.45, 18.45, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260528' AND li.sort_order = 0
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260528'),
        N'SHS20*20*2.5', 15.0, 12.4, 12.4, 0;

IF NOT EXISTS (
    SELECT 1 FROM dbo.POLineItems li
    JOIN dbo.PurchaseOrders po ON li.po_id = po.id
    WHERE po.reference = N'P260528' AND li.sort_order = 1
)
    INSERT INTO dbo.POLineItems (po_id, description, quantity, unit_price, line_total, sort_order)
    SELECT
        (SELECT TOP 1 id FROM dbo.PurchaseOrders WHERE reference = N'P260528'),
        N'SHS', NULL, NULL, NULL, 1;

PRINT 'Line items inserted (416 rows).';