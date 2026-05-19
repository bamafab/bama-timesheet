-- ============================================================
-- BAMA ERP: PO Tracker Data Import
-- Generated: 2026-05-19
-- Run against: bama-erp
-- ============================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

-- ──────────────────────────────────────────────────────────
-- 1. SUPPLIERS (upsert from Client List + extras)
-- ──────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'5750 Components')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'5750 Components', N'Daniel Mercer', N'daniel.mercer@5750components.co.uk', N'0151 5485750', N'Knowsley Business Park, Villiers Road, Knowsley, Merseyside, L34 9ET', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'A H Allen Steel Services', N'Max Bishop', N'max.bishop@ahasteel.com', N'01604 762211', N'Liliput Rd, Northampton NN4 7DT', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'AJN Steelstock', N'Lee Allars', N'lee.allars@ajnsteelstock.co.uk', N'01638 555 500', N'Icknield Way, Kentford, Newmarket, Suffolk CB8 7QT', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Amazon')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Amazon', NULL, NULL, N'020 70847911', N'60 Holborn Viaduct London EC4', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'B&Q')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'B&Q', NULL, N'home.delivery@b-and-q.co.uk', N'0333 0143357', N'B&Q House, Chestnut Avenue, Chandler''s Ford, Eastleigh, Hampshire, SO53 3LE', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Bama South West')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Bama South West', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Bapp')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Bapp', N'Steve Dolby', N'steve@bappleicester.co.uk / sales@bappleicester.co.uk', N'07966 880595 / 01162 841888', N'Unit 7, Mill Hill Industrial Estate, Enderby, Leicestershire, LE19 4AH', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'BM Steel')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'BM Steel', N'John Raven', N'john.raven@bmsteel.co.uk', N'01733 312921', N'Oxney Rd, Peterborough PE1 5YW', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'BMS Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'BMS Ltd', N'Gerard O''Shaughnessy', N'gerard@bmsmarketingltd.co.uk', N'07908 545028', N'First Floor, Unit 12, Pennine Business Park, Longbow Close, Bradley Rd, Bradley, Huddersfield HD2 1GQ', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'BOC Gas & Gear', N'Gary Hancock', N'gary.hancock@boc.com', N'01733 344422', N'Vicarage Farm Road, Peterborough, PE1 5TP', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Leicester')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Brandon Hire Station Leicester', NULL, N'leicester@brandonhirestation.com', N'0116 2775277', N'Unit 12 Wilson Road, South Wigston, Leicester LE18 4TP', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Peterborough')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Brandon Hire Station Peterborough', N'Kim Ashton', N'Peterborough@brandonhirestation.com', N'01733 260044', N'Unit 1 Saville Rd Industrial Est, Westwood, Peterborough PE3 7PR', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Reading')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Brandon Hire Station Reading', NULL, N'reading@brandonhirestation.com', N'0118 9503175', N'4 Richfield Ave, Reading RG1 8EQ', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Stevenage')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Brandon Hire Station Stevenage', NULL, N'Andrew.Payne@vpplc.com', N'01438 203600', N'Unit 2, Motorway Industrial Estate, Babbage Rd, Stevenage SG1 2EQ', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Brass Works')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Brass Works', N'Sales', N'sales@brass-works.co.uk', N'0330 3904 377', N'Soothill Business Park, Soothill Lane, Soothill, Batley, England, WF17 6NY', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Brewers')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Brewers', NULL, N'peterborough@brewers.co.uk', N'01733 558161', N'Albany House, Ashford Road, Eastbourne, BN21 3TR', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'British Standard Institution')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'British Standard Institution', NULL, N'bsiremittances@bsigroup.com', N'01908 915906', N'7/8 Floors, The Acre, 90 Long Acre, London, WC2E 9RA', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'CEF City Electrical')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'CEF City Electrical', NULL, N'customerservices@cef.co.uk <customerservices@cef.co.uk>', N'01733 310350', N'Fengate, Peterborough, PE1 5XG', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'County Fasteners Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'County Fasteners Ltd', N'Dave', N'https://countyfasteners.com/', N'01752 223999', N'Unit 33, Faraday Mill, business park, Cattedown, Plymouth PL4 0ST', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'CPR Reccruitment Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'CPR Reccruitment Ltd', N'Jack Fletcher', N'Jack.Fletcher@cprrecruit.com', N'07566 797924', N'The Business Terrace, Maidstone, Kent, ME15 6JQ, United Kingdom', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Creditsafe')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Creditsafe', N'Claire Golubovic', N'Claire.Golubovic@creditsafeuk.com', N'02920 886 500', N'Ty Meridian, Malthouse Avenue, Cardiff Gate Business Park, Pontprennau, Cardiff CF23 8AU', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Dale Sheetmetal Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Dale Sheetmetal Ltd', N'Simon Parker', N'simon@dalesheetmetal.com', N'01553 765554', N'27 Austin Fields, King''s Lynn, Norfolk, PE30 1PH', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'DC Iron')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'DC Iron', N'Sales', N'sales@dciron.co.uk', N'0191 488 1112', N'3 Whickham Industrial Estate, Swalwell, Newcastle upon Tyne, NE16 3DA', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Dodman Ltd', N'Luke Smith', N'ls@dodman.com', N'01553 423300', N'24 Hamburg Way, King''s Lynn, Norfolk, PE30 2ND', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'East Anglian Galvanising')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'East Anglian Galvanising', N'Selwyn Parrish', N'selwyn.parrish@wggltd.co.uk', N'01487 833160', N'Old North Road, Sawtry, Cambridgeshire, PE28 5XN', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Edanbrook UK')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Edanbrook UK', N'Gerard Dominic Moss', N'gerard@edanbrook.com', N'020 81231261', N'Unit 3A 34-35 Hatton Garden Holborn, London, England, EC1N 8DX', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Excalibur Labour Hire Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Excalibur Labour Hire Ltd', N'Ana', N'info@excaliburlabourhire.com', N'01934 411 340', N'7 Heligan Walk, Weston Super Mare Somerset BS24 7JJ', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'F H Brundle', N'Connor Branigan', N'sarah.morrison@brundle.com / connor.branigan@brundle.com', N'0115 9302070', N'Condor Road, Quarry Hill Industrial Estate, Ilkeston DE7 4RE', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'GL Profiles Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'GL Profiles Ltd', N'Ashleigh Bentley', N'sales@glprofiles.co.uk', N'01354 694694', N'Tudor Rose Industrial Estate, Units 8-10, Dock Rd, Chatteris PE16 6TY', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Granville Supplies')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Granville Supplies', NULL, N'sales@granvillesupplies.co.uk', N'01733 340100', N'Fengate, Peterborough, PE1 5XG', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Green Circles (BC Wiles)')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Green Circles (BC Wiles)', NULL, N'keeley.smith@greencirclelogistics.co.uk', N'07392 086889', N'Morley Court, Morley Way, Peterborough, PE2 7BW', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Heze Limited')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Heze Limited', NULL, N'ilona.hyz@heze.co.uk', N'01214 487030', N'Little Fields Way, Oldbury, West Midlands, B69 2BT', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Howsafe')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Howsafe', N'Howsafe', N'sales@howsafe.co.uk', N'01733 560 669', N'18-20 Challenger Way, Edgerley Business Park, Peterborough, Cambridgeshire, PE1 5EX,', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'HTS SPARES')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'HTS SPARES', NULL, N'info@htsspares.com', N'01432 373 350', N'7 Beacon Rd,
Rotherwas Industrial Estate,Hereford HR2 6JF', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Laser Profile')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Laser Profile', N'Gemma Hibbs', N'ghibbs@laserprofiles.co.uk', N'01202 875657', N'Unit 3 Aerial Park, Uddens Trading Estate Wimborne, Dorset, BH21 7NL', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Optima Metal Services')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Optima Metal Services', N'Tiago Oliviera', N'Tiago@optima.co.uk', N'01553 818053', N'Hamlin Way, Kings Lynn, Norfolk, PE30 4NG', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Orion Alloys Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Orion Alloys Ltd', N'Nick Bardle', N'nick@orionalloys.com', N'01279 434422', N'Unit A1, River Way Industrial Estate, Harlow, Essex, CM20 2DP', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'PLP Lift Trucks')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'PLP Lift Trucks', NULL, N'PLP Lift Trucks Peter Borough', N'01733 332006', N'41 Ivatt Way, Peterborough PE3 7PN', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Plumb City')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Plumb City', NULL, N'kingslynn@plumbcity.com', N'01553 766248', N'10 Campbells Business Park, Campbells Meadow, Kings Lynn, PE30 4YR', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Polar Systems')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Polar Systems', N'Connor Empson', N'connor.empson@polar-systems.co.uk', N'01553 691472', N'Oldmedow Road King''s Lynn, Oldmedow Rd, King''s Lynn PE30 4LA', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'PPS Print')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'PPS Print', NULL, N'info@pps-print.com', N'01733 349881', N'Ainsley House, Fengate, Peterborough, Cambridgeshire, England, PE1 5XG', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Premier Galvanizing Ltd (Corby)')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Premier Galvanizing Ltd (Corby)', N'Emily Hawkins', N'emilyh@premiergalv.co.uk', N'01536 409818', N'East Ind Est, Willowbrook East Ind Est Darwin Road Willowbrook, Corby NN17 5XZ', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'SafeWear')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'SafeWear', N'Kris Parkes', NULL, N'01752 408694', N'Faraday Rd Unit 38, Faraday Mill Business Park, Plymouth PL4 0ST', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Screwfix')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Screwfix', NULL, N'online@screwfix.com', N'03330 112112', N'Units 11&12, Discovery Business Park, Broadway, Yaxley, Peterborough PE7 3GX', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Selmach Machinery')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Selmach Machinery', NULL, N'consumables@selmach.com', N'01432 346580', N'Technology Centre, Beacon Road, Rotherwas, Hereford, HR2 6JF', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Smith Brothers Stores Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Smith Brothers Stores Ltd', NULL, N'peterborough@sbs.co.uk', N'01733 311711', N'7 Empson Rd, Peterborough PE1 5UP', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Southern Sheeting Supplies Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Southern Sheeting Supplies Ltd', N'Christina Olsson', N'christina.olsson@southernsheeting.co.uk', N'01509 426300', N'Unit 4A/4B Wymeswold Business Quarter, Burton Lane, Wymeswold, LE12 5BS', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Sterling Bolt & Nut Co. Ltd', N'Anna Beverley', N'sales@sterlingbolt.co.uk', N'01733 563022', N'25 Royce Rd, Carr Road Ind Est, Peterborough, PE1 5YB', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Summit Platforms')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Summit Platforms', N'Tom Baker', N'londonwest@summitplatforms.co.uk; tombaker@summitplatforms.co.uk', N'01923 979 388', N'Brent Yard, Travellers Lane, Welham Green, Herts, AL9 7HF', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'TLC (Southern) Limited')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'TLC (Southern) Limited', NULL, N'sales@tlc-direct.co.uk', N'02392 654222', N'TLC Building, Newton Road, Crawley, West Sussex, RH10 9TS', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Toolstation')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Toolstation', NULL, NULL, NULL, N'Vision House, 19 Colonial Way, Watford, WD24 4JL', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'United Welding Supplies', N'Martin', N'peterborough@unitedwelding.co.uk', N'01733 261 361', N'45 Ivatt Way Westwood Peterborough, PE3 7PN', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Vernal')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Vernal', N'Sales', N'service-uk@vernalspace.com', N'+44 7380 307916', N'Suite 2, Second Floor Sovereign House, 1 Albert Place, London', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Wickes')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Wickes', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'JT Cranes')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'JT Cranes', N'Darren Lee', N'darren@jtcranes.co.uk', N'01767 677155', N'Caxton Road, Great Gransden, Sandy, Bedfordshire, SG19 3BH', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Graitec Limited')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Graitec Limited', N'Michael Mul', N'michael.mul@graitec.com', N'023 8086 8947', N'Mountbatten House, Grosvenor Square, Southampton, England, SO15 2JU', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Autodesk')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Autodesk', NULL, NULL, N'0800 032 8050', N'Talbot Way, Small Heath Business Park Birmingham, United Kingdom, United Kingdom, B10 0HJ', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Orbital Fasteners Ltd')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Orbital Fasteners Ltd', NULL, N'sales@orbitalfasteners.co.uk', N'01923 777777', N'Olds Approach, Tolpits Ln, Northwood, Watford WD18 9XT', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'WS Transportation')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'WS Transportation', NULL, N'invoicing@wstransportation.com', N'01945 589000', N'Ashville Way. Ashville Industrial Est, Runcorn Cheshire WA7 3EZ', 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Trade Point B&Q')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Trade Point B&Q', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Brandon Hire', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Barret Steel')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Barret Steel', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Babcock')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Babcock', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'CBS Power Tools')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'CBS Power Tools', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Bend Tech')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Bend Tech', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'DCT TRAINING SERVICES')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'DCT TRAINING SERVICES', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Hcity Plumbing')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Hcity Plumbing', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'MAXUS IT')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'MAXUS IT', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'SURESPAN')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'SURESPAN', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Traditional Beams')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Traditional Beams', NULL, NULL, NULL, NULL, 1, GETUTCDATE());
IF NOT EXISTS (SELECT 1 FROM dbo.Suppliers WHERE supplier_name = N'Viking Direct')
    INSERT INTO dbo.Suppliers (supplier_name, contact_name, email, telephone, address_line1, is_active, updated_at)
    VALUES (N'Viking Direct', NULL, NULL, NULL, NULL, 1, GETUTCDATE());

PRINT 'Suppliers inserted.';

-- ──────────────────────────────────────────────────────────
-- 2. COST CENTRES: replace with {"5099":"Office","8099":"Workshop"}
-- ──────────────────────────────────────────────────────────

UPDATE dbo.Settings
   SET value      = N'{"5099":"Office","8099":"Workshop"}'
     , updated_at = GETUTCDATE()
 WHERE [key] = 'purchase_order_cost_centres';

PRINT 'Cost centres updated.';

-- ──────────────────────────────────────────────────────────
-- 3. PURCHASE ORDERS (P26xxxx only, idempotent)
-- ──────────────────────────────────────────────────────────

-- 206 POs to insert

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260101')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260101',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Toolstation'),
         N'S1953 - Bama office extension', N'S1953', N'Bama office extension',
         169.956, 20.0, 28.33,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-01-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260102')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260102',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'LESZEK', '2026-01-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260103')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260103',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'SafeWear'),
         N'S1977 - Volkerstevin', N'S1977', N'Volkerstevin',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'CANCELLED', '2026-01-06', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260104')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260104',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'British Standard Institution'),
         N'8099', N'8099', N'Audit',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'LESZEK', '2026-01-06', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260105')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260105',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'LESZEK', '2026-01-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260106')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260106',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'LESZEK', GETUTCDATE(), GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260107')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260107',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Barret Steel'),
         N'S1979 - Camel Construction', N'S1979', N'Camel Construction',
         2630.172, 20.0, 438.36,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-14', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260108')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260108',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1975 - Spiral Stairs', N'S1975', N'Spiral Stairs',
         88.2, 20.0, 14.7,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260109')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260109',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1979 - Camel Construction', N'S1979', N'Camel Construction',
         171.528, 20.0, 28.59,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260110')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260110',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bend Tech'),
         N'S1975 - Spiral Stairs', N'S1975', N'Spiral Stairs',
         117.6, 20.0, 19.6,
         N'Open', NULL, NULL, 45.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-01-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260111')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260111',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'S1914 - Devonport Ph1 Temporary Works', N'S1914', N'Devonport Ph1 Temporary Works',
         113.94, 20.0, 18.99,
         N'Received', NULL, NULL, NULL,
         N'150938609', '2026-01-16', NULL,
         N'Import', '2026-01-16', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260112')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260112',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Barret Steel'),
         N'S1980 - Hawk Developments', N'S1980', N'Hawk Developments',
         444.0, 20.0, 74.0,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260113')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260113',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Barret Steel'),
         N'S1980 - Hawk Developments', N'S1980', N'Hawk Developments',
         918.36, 20.0, 153.06,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260114')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260114',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1930 - The Mill Barn', N'S1930', N'The Mill Barn',
         253.44, 20.0, 42.24,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260115')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260115',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         29.052, 20.0, 4.84,
         N'Open', '2026-01-21', NULL, NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-01-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260116')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260116',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'CBS Power Tools'),
         N'8099', N'8099', N'Tools',
         93.6, 20.0, 15.6,
         N'Open', '2026-01-21', NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260117')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260117',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Viking Direct'),
         N'5099', N'5099', N'Office',
         137.484, 20.0, 22.91,
         N'Open', '2026-01-21', NULL, NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-01-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260118')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260118',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         424.14, 20.0, 70.69,
         N'Open', '2026-01-22', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-01-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260119')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260119',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'DCT TRAINING SERVICES'),
         N'8099', N'8099', N'Workshop',
         324.0, 20.0, 54.0,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-01-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260120')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260120',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1980 - Hawk Developments - Structural', N'S1980', N'Hawk Developments - Structural',
         107.556, 20.0, 17.93,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', '2026-01-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260121')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260121',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         633.6, 20.0, 105.6,
         N'Open', '2026-01-26', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-01-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260122')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260122',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1975 - Spiral Stairs', N'S1975', N'Spiral Stairs',
         882.0, 20.0, 147.0,
         N'Open', '2026-02-09', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-01-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260123')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260123',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         230.712, 20.0, 38.45,
         N'Open', '2026-01-27', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-01-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260124')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260124',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1975 - Spiral Stairs', N'S1975', N'Spiral Stairs',
         556.26, 20.0, 92.71,
         N'Open', '2026-01-30', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-01-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260125')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260125',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Workshop',
         15.984, 20.0, 2.66,
         N'Open', '2026-01-28', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 0.0,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-01-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260126')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260126',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bapp'),
         N'S1975 - Spiral Stairs', N'S1975', N'Spiral Stairs',
         14.196, 20.0, 2.37,
         N'Open', '2026-01-29', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-01-28', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260127')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260127',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         741.6, 20.0, 123.6,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-01-29', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260128')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260128',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'CEF City Electrical'),
         N'8099', N'8099', N'Workshop',
         15.54, 20.0, 2.59,
         N'Open', '2026-02-05', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260129')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260129',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Plumb City'),
         N'8099', N'8099', N'Workshop',
         14.652, 20.0, 2.44,
         N'Open', '2026-02-05', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260130')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260130',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Plumb City'),
         N'8099', N'8099', N'Workshop',
         11.424, 20.0, 1.9,
         N'Open', '2026-02-05', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260131')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260131',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         16.68, 20.0, 2.79,
         N'Open', '2026-02-20', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-02-20', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260132')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260132',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         6.252, 20.0, 1.04,
         N'Open', '2026-02-23', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-02-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260133')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260133',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'SURESPAN'),
         N'B0068 - Babcock - 2 Basin Hatch', N'B0068', N'Babcock - 2 Basin Hatch',
         217.2, 20.0, 36.2,
         N'Received', NULL, N'2 Birkbeck close Plymouth, PL7 4BW', 30.0,
         N'ENOQ60075', '2026-02-04', NULL,
         N'Daniel Bojanski', '2026-02-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260201')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260201',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1981 - 83 Priory Lane, North Wootton', N'S1981', N'83 Priory Lane, North Wootton',
         701.22, 20.0, 116.87,
         N'Open', '2026-02-09', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 12.95,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260202')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260202',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'SafeWear'),
         N'8099', N'8099', N'PPE for Scott',
         222.98, 20.0, 18.28,
         N'Received', '2026-02-05', N'2 Birkbeck close Plymouth, PL7 4BW', NULL,
         N'INV-24169', '2026-02-05', NULL,
         N'Lee Kirtley', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260203')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260203',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Traditional Beams'),
         N'S1975 - Spiral Stairs', N'S1975', N'Spiral Stairs',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Import', GETUTCDATE(), GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260204')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260204',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Hcity Plumbing'),
         N'8099', N'8099', N'Office',
         90.576, 20.0, 15.1,
         N'Open', NULL, N'Collection from store', 0.0,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260205')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260205',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'B0061 - 9 Wharf New Hatch', N'B0061', N'9 Wharf New Hatch',
         409.08, 20.0, 68.18,
         N'Open', '2026-02-12', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 45.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260206')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260206',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1965 - Aluminum SHS', N'S1965', N'Aluminum SHS',
         204.0, 20.0, 34.0,
         N'Open', '2026-02-12', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260208')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260208',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         359.472, 20.0, 59.91,
         N'Open', '2026-02-09', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 11.95,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-06', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260209')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260209',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'DC Iron'),
         N'B0061 - 9 Wharf New Hatch', N'B0061', N'9 Wharf New Hatch',
         20.58, 20.0, 3.43,
         N'Open', '2026-02-11', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 9.95,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260210')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260210',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         92.652, 20.0, 15.44,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260211')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260211',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1981 - 83 Priory Lane, North Wootton', N'S1981', N'83 Priory Lane, North Wootton',
         9.24, 20.0, 1.54,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260212')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260212',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'8099', N'8099', N'Workshop',
         119.916, 20.0, 19.99,
         N'Open', '2026-02-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 0.0,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260213')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260213',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         701.088, 20.0, 116.85,
         N'Open', NULL, NULL, 0.0,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260214')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260214',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1981 - 83 Priory Lane, North Wootton', N'S1981', N'83 Priory Lane, North Wootton',
         9.24, 20.0, 1.54,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-12', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260215')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260215',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'East Anglian Galvanising'),
         N'B0061 - 9 Wharf New Hatch', N'B0061', N'9 Wharf New Hatch',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-16', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260216')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260216',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'B0061 - 9 Wharf New Hatch', N'B0061', N'9 Wharf New Hatch',
         2.436, 20.0, 0.41,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-16', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260217')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260217',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1982 - Kaja Services - Structural Fabrication', N'S1982', N'Kaja Services - Structural Fabrication',
         242.904, 20.0, 40.48,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-16', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260218')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260218',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Babcock'),
         N'8099', N'8099', N'Babcock',
         388.25, 20.0, 102.21,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260219')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260219',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         169.992, 20.0, 28.33,
         N'Open', '2026-02-17', NULL, NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260220')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260220',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         1438.248, 20.0, 239.71,
         N'Open', '2026-02-19', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 12.95,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260221')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260221',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1980 - 45 Kings Road, Berkhamsted', N'S1980', N'45 Kings Road, Berkhamsted',
         2062.32, 20.0, 343.72,
         N'Open', '2026-02-20', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-02-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260222')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260222',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         189.228, 20.0, 31.54,
         N'Open', '2026-02-20', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260223')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260223',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         204.0, 20.0, 34.0,
         N'Open', '2026-02-20', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 0.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-02-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260225')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260225',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         741.6, 20.0, 123.6,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260226')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260226',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bapp'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         860.388, 20.0, 143.4,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260227')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260227',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bapp'),
         N'S1980 - Hawk Developments - Structural', N'S1980', N'Hawk Developments - Structural',
         37.836, 20.0, 6.31,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260228')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260228',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1980 - Hawk Developments - Structural', N'S1980', N'Hawk Developments - Structural',
         119.064, 20.0, 19.84,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260229')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260229',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         94.8, 20.0, 15.8,
         N'Open', '2026-02-25', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 10.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260230')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260230',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         20.244, 20.0, 3.37,
         N'Open', '2026-02-24', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 0.0,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260231')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260231',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Granville Supplies'),
         N'8099', N'8099', N'Workshop',
         86.4, 20.0, 14.4,
         N'Open', '2026-02-26', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-02-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260232')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260232',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Granville Supplies'),
         N'8099', N'8099', N'Workshop',
         36.78, 20.0, 6.13,
         N'Open', '2026-03-02', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-02', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260233')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260233',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         34.02, 20.0, 5.67,
         N'Open', '2026-03-03', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-03', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260234')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260234',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         14.112, 20.0, 2.35,
         N'Open', '2026-03-04', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260235')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260235',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         7.992, 20.0, 1.33,
         N'Open', '2026-03-04', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260236')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260236',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         48.48, 20.0, 8.08,
         N'Open', '2026-03-09', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260237')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260237',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Toolstation'),
         N'8099', N'8099', N'Workshop',
         21.4644, 20.0, 3.58,
         N'Open', '2026-03-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260238')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260238',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'MAXUS IT'),
         N'5099', N'5099', N'Office',
         50.0, 0.0, 0.0,
         N'Received', '2026-02-25', N'-', 0.0,
         N'7770', '2026-02-25', NULL,
         N'Daniel Bojanski', '2026-02-25', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260239')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260239',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         9177.6, 20.0, 1529.6,
         N'Open', '2026-03-13', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-02-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260240')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260240',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         6069.6, 20.0, 1011.6,
         N'Open', '2026-03-04', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260241')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260241',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'S1983 - Stoneguard', N'S1983', N'Stoneguard',
         27.984, 20.0, 4.66,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260242')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260242',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Selmach Machinery'),
         N'8099', N'8099', N'Workshop',
         325.02, 20.0, 54.17,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 14.95,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260243')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260243',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brewers'),
         N'8099', N'8099', N'Office',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-02-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260244')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260244',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'CANCELLED - CANCELLED', N'CANCELLED', N'CANCELLED',
         NULL, 20.0, NULL,
         N'Cancelled', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-02-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260245')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260245',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1981 - 83 Priory Lane, North Wootton', N'S1981', N'83 Priory Lane, North Wootton',
         407.04, 20.0, 67.84,
         N'Open', '2026-03-02', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260246')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260246',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         978.048, 20.0, 163.01,
         N'Open', '2026-03-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-02-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260247')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260247',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Toolstation'),
         N'8099', N'8099', N'Workshop',
         8.484, 20.0, 1.41,
         N'Open', '2026-03-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260248')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260248',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Wickes'),
         N'8099', N'8099', N'Workshop',
         28.3, 20.0, 4.13,
         N'Open', '2026-03-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Ihor Zelyk', '2026-03-02', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260249')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260249',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Howsafe'),
         N'8099', N'8099', N'Workshop',
         88.2, 20.0, 14.7,
         N'Open', NULL, N'Collection from store', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-02', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260301')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260301',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         23.64, 20.0, 3.94,
         N'Open', '2026-03-03', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-03-02', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260302')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260302',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'8099', N'8099', N'Workshop',
         7.8, 20.0, 1.3,
         N'Open', '2026-03-03', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Basia Soszynska', '2026-03-02', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260303')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260303',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         90.24, 20.0, 15.04,
         N'Open', '2026-03-04', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-03', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260304')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260304',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'DC Iron'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         47.916, 20.0, 7.99,
         N'Received', '2026-03-05', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 9.95,
         N'#W7Y7XD9N9', '2026-03-03', NULL,
         N'Daniel Bojanski', '2026-03-03', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260305')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260305',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Vernal'),
         N'5099', N'5099', N'Office',
         95.988, 20.0, 16.0,
         N'Received', '2026-03-07', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         N'VERNAL-UK5112', '2026-03-03', NULL,
         N'Daniel Bojanski', '2026-03-03', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260306')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260306',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         808.92, 20.0, 134.82,
         N'Open', '2026-03-06', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-03', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260307')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260307',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         750.0, 20.0, 125.0,
         N'Open', '2026-03-05', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 12.95,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-03', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260308')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260308',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         752.64, 20.0, 125.44,
         N'Open', '2026-03-06', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-03', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260309')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260309',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'SafeWear'),
         N'8099', N'8099', N'Babcock Maintenance',
         NULL, 20.0, NULL,
         N'Open', '2026-03-04', N'Collection from store', NULL,
         NULL, NULL, NULL,
         N'Lee Kirtley', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260310')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260310',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         34.776, 20.0, 5.8,
         N'Open', '2026-03-05', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Basia Soszynska', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260311')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260311',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'British Standard Institution'),
         N'8099', N'8099', N'Office',
         1455.6, 20.0, 242.6,
         N'Open', '2026-04-02', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260312')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260312',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1930 - Mill Barn', N'S1930', N'Mill Barn',
         261.924, 20.0, 43.65,
         N'Open', '2026-03-09', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260313')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260313',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bapp'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         186.0, 20.0, 31.0,
         N'Open', '2026-03-06', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260314')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260314',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Howsafe'),
         N'8099', N'8099', N'Office',
         NULL, 20.0, NULL,
         N'Open', NULL, N'Collection from store', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-04', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260315')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260315',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies'),
         N'8099', N'8099', N'Workshop',
         114.252, 20.0, 19.04,
         N'Open', '2026-03-06', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 0.0,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-06', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260316')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260316',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         347.28, 20.0, 57.88,
         N'Open', '2026-03-07', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-03-06', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260317')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260317',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         150.0, 20.0, 25.0,
         N'Open', '2026-03-07', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Basia Soszynska', '2026-03-07', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260318')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260318',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies'),
         N'8099', N'8099', N'Workshop',
         12.72, 20.0, 2.12,
         N'Open', '2026-03-07', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260319')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260319',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1930 - Mill Barn', N'S1930', N'Mill Barn',
         34.152, 20.0, 5.69,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260320')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260320',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1982 - Kaja Services - Structural Fabrication', N'S1982', N'Kaja Services - Structural Fabrication',
         84.6, 20.0, 14.1,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260321')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260321',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         44.7, 20.0, 7.45,
         N'Open', '2026-03-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-03-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260322')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260322',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1987 - Bailey and Jones', N'S1987', N'Bailey and Jones',
         282.684, 20.0, 47.11,
         N'Open', '2026-03-13', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260323')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260323',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'County Fasteners Ltd'),
         N'8099', N'8099', N'Babcock Maintenance',
         59.02, 20.0, 9.83,
         N'Open', '2026-03-12', N'collection', 0.0,
         NULL, NULL, NULL,
         N'Lee Kirtley', '2026-03-12', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260324')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260324',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Babcock Maintenance',
         21.99, 20.0, 3.66,
         N'Open', '2026-03-12', N'Collection from store', 0.0,
         NULL, NULL, NULL,
         N'Lee Kirtley', '2026-03-12', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260325')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260325',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         33.936, 20.0, 5.66,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Basia Soszynska', GETUTCDATE(), GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260326')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260326',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'WS Transportation'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         76.716, 20.0, 12.79,
         N'Open', NULL, N'Debra Challinor, Blackpool FY2 0QW', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260327')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260327',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'B0075 - Rubble Jetty - Plymouth', N'B0075', N'Rubble Jetty - Plymouth',
         734.424, 20.0, 122.4,
         N'Open', '2026-03-22', N'Blackpool GB-FY2 0QW', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260328')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260328',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies'),
         N'8099', N'8099', N'Workshop',
         52.8, 20.0, 8.8,
         N'Open', '2026-03-17', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260329')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260329',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'B0071 - 16 Wharf - Plymouth', N'B0071', N'16 Wharf - Plymouth',
         69.6, 20.0, 11.6,
         N'Open', '2026-03-18', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 10.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260330')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260330',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'B0071 - 16 Wharf - Plymouth', N'B0071', N'16 Wharf - Plymouth',
         509.82, 20.0, 84.97,
         N'Open', '2026-03-19', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 30.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260331')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260331',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'East Anglian Galvanising'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         5205.6, 20.0, 867.6,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 180.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-03-18', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260333')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260333',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         11312.4, 20.0, 1885.4,
         N'Open', '2026-03-26', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-20', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260334')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260334',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         10.788, 20.0, 1.8,
         N'Open', '2026-03-21', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-03-20', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260335')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260335',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'PLP Lift Trucks'),
         N'8099', N'8099', N'Workshop',
         73.5, 20.0, 3.5,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-20', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260336')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260336',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         187.104, 20.0, 31.18,
         N'Open', '2026-03-23', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-03-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260337')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260337',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'HTS SPARES'),
         N'8099', N'8099', N'Workshop',
         167.4, 20.0, 27.9,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260338')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260338',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1989 - Bailey and Jones Drop Bolts', N'S1989', N'Bailey and Jones Drop Bolts',
         50.4, 20.0, 8.4,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260340')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260340',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         3965.208, 20.0, 660.87,
         N'Open', '2026-03-29', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260341')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260341',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         17070.0, 20.0, 2845.0,
         N'Open', '2026-03-29', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260342')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260342',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1990 - Harrison Fabrication - Gate', N'S1990', N'Harrison Fabrication - Gate',
         122.4, 20.0, 20.4,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260343')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260343',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1990 - Harrison Fabrication - Gate', N'S1990', N'Harrison Fabrication - Gate',
         129.6, 20.0, 21.6,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260344')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260344',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         2342.4, 20.0, 390.4,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260345')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260345',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Optima Metal Services'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         1985.544, 20.0, 330.92,
         N'Open', '2026-03-30', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 0.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-03-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260346')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260346',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         389.7, 20.0, 64.95,
         N'Open', '2026-03-26', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260347')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260347',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         7872.0, 20.0, 1312.0,
         N'Open', '2026-04-01', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-25', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260348')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260348',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bapp'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         1321.056, 20.0, 220.18,
         N'Open', '2026-04-01', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260349')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260349',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         30.288, 20.0, 5.05,
         N'Open', '2026-03-27', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-03-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260350')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260350',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         1544.16, 20.0, 257.36,
         N'Open', '2026-04-01', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-26', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260351')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260351',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1990 - Harrison Fabrication - Gate', N'S1990', N'Harrison Fabrication - Gate',
         23.616, 20.0, 3.94,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-03-30', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260401')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260401',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies'),
         N'8099', N'8099', N'Workshop',
         426.24, 20.0, 71.04,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-01', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260402')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260402',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'B0035 - Plymouth/BAMA South West', N'B0035', N'Plymouth/BAMA South West',
         192.0, 20.0, 32.0,
         N'Open', '2026-04-09', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 40.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-01', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260403')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260403',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'A H Allen Steel Services'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         318.0, 20.0, 53.0,
         N'Open', '2026-04-09', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-01', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260404')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260404',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Summit Platforms'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         645.744, 20.0, 107.62,
         N'Open', '2026-04-16', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', 196.0,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-04-01', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260405')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260405',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1992 - Galv Trims - RG Carter', N'S1992', N'Galv Trims - RG Carter',
         281.592, 20.0, 46.93,
         N'Open', '2026-04-14', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-02', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260406')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260406',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1991 - Manhole Cover - RG Carter', N'S1991', N'Manhole Cover - RG Carter',
         102.408, 20.0, 17.07,
         N'Open', '2026-04-14', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-02', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260407')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260407',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         1886.988, 20.0, 314.5,
         N'Open', '2026-04-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260408')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260408',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Laser Profile'),
         N'B0074 - Plymouth/BAMA South West', N'B0074', N'Plymouth/BAMA South West',
         2226.0, 20.0, 371.0,
         N'Open', '2026-04-17', N'3 Basin, Devonport Royal Dockyard, Plymouth, Devon   PL1 4SG.', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260409')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260409',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         66.3, 20.0, 11.05,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-09', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260410')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260410',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'B0078 - Plymouth/BAMA South West', N'B0078', N'Plymouth/BAMA South West',
         446.4, 20.0, 74.4,
         N'Open', '2026-04-21', N'3 Basin, Devonport Royal Dockyard, Plymouth, Devon   PL1 4SG.', 50.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260411')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260411',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         570.0, 20.0, 95.0,
         N'Open', '2026-04-14', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260412')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260412',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         403.2, 20.0, 67.2,
         N'Open', '2026-04-14', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260413')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260413',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Reading'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         373.344, 20.0, 62.22,
         N'Open', '2026-04-14', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', 40.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-10', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260414')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260414',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         612.096, 20.0, 102.02,
         N'Open', '2026-04-16', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 15.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260415')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260415',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'B&Q'),
         N'B0075 - Plymouth/BAMA South West', N'B0075', N'Plymouth/BAMA South West',
         24.816, 20.0, 4.14,
         N'Open', '2026-04-13', N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Lee Kirtley', '2026-04-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260416')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260416',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'PPS Print'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         57.6, 20.0, 9.6,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260417')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260417',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'8099', N'8099', N'Workshop',
         25.488, 20.0, 4.25,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260418')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260418',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'County Fasteners Ltd'),
         N'B0075 - Plymouth/BAMA South West', N'B0075', N'Plymouth/BAMA South West',
         30.66, 20.0, 5.11,
         N'Open', '2026-04-13', N'Devonport Dockyard', 0.0,
         NULL, NULL, NULL,
         N'Lee Kirtley', '2026-04-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260419')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260419',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Leicester'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         650.4, 20.0, 108.4,
         N'Open', '2026-04-20', N'Indoor Market, 144-115 Market Square, Stevenage, SG1 1EP', 50.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260420')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260420',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'SafeWear'),
         N'B0075 - Plymouth/BAMA South West', N'B0075', N'Plymouth/BAMA South West',
         135.456, 20.0, 22.58,
         N'Open', '2026-04-13', N'Devonport Dockyard', 0.0,
         NULL, NULL, NULL,
         N'Lee Kirtley', '2026-04-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260421')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260421',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'8099', N'8099', N'Workshop',
         77.004, 20.0, 12.83,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-04-14', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260422')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260422',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         544.236, 20.0, 90.71,
         N'Open', '2026-04-15', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-14', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260423')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260423',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Creditsafe'),
         N'5099', N'5099', N'Office',
         720.0, 20.0, 120.0,
         N'Open', '2026-04-14', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260424')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260424',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1993 - Coop, Ancaster, Ermine St', N'S1993', N'Coop, Ancaster, Ermine St',
         2668.8, 20.0, 444.8,
         N'Open', '2026-04-21', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260425')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260425',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Dodman Ltd'),
         N'S1993 - Coop, Ancaster, Ermine St', N'S1993', N'Coop, Ancaster, Ermine St',
         832.44, 20.0, 138.74,
         N'Open', '2026-04-21', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260426')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260426',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Summit Platforms'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         636.0, 20.0, 106.0,
         N'Open', '2026-04-16', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', 180.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260427')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260427',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'8099', N'8099', N'Workshop',
         1010.928, 20.0, 168.49,
         N'Open', '2026-04-17', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-04-16', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260428')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260428',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Summit Platforms'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         492.0, 20.0, 82.0,
         N'Open', '2026-04-20', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', 220.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-16', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260429')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260429',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         19.992, 20.0, 3.33,
         N'Open', '2026-04-18', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260430')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260430',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         79.608, 20.0, 13.27,
         N'Open', '2026-04-17', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260431')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260431',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Southern Sheeting Supplies Ltd'),
         N'S1993 - Coop, Ancaster, Ermine St', N'S1993', N'Coop, Ancaster, Ermine St',
         1527.6, 20.0, 254.6,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-17', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260432')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260432',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Stevenage'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         215.6676, 20.0, 35.94,
         N'Open', '2026-04-22', N'Indoor Market, 144-115 Market Square, Stevenage, SG1 1EP', 48.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260433')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260433',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Leicester'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         141.6, 20.0, 23.6,
         N'Open', '2026-04-22', N'Indoor Market, 144-115 Market Square, Stevenage, SG1 1EP', 50.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-21', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260434')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260434',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Premier Galvanizing Ltd (Corby)'),
         N'S1993 - Coop, Ancaster, Ermine St', N'S1993', N'Coop, Ancaster, Ermine St',
         1885.2, 20.0, 314.2,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 140.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-23', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260435')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260435',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'S1983 - Merlin Place', N'S1983', N'Merlin Place',
         18.912, 20.0, 3.15,
         N'Open', '2026-04-27', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 10.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-24', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260436')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260436',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies'),
         N'8099', N'8099', N'Workshop',
         470.808, 20.0, 78.47,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260437')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260437',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Toolstation'),
         N'S1982 - NHC Stevenage', N'S1982', N'NHC Stevenage',
         40.98, 20.0, 6.83,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260438')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260438',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bapp'),
         N'S1993 - Coop, Ancaster, Ermine St', N'S1993', N'Coop, Ancaster, Ermine St',
         156.012, 20.0, 26.0,
         N'Open', '2026-04-28', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260439')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260439',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Sterling Bolt & Nut Co. Ltd'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         40.23, 20.0, 6.7,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-28', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260440')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260440',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         NULL, 20.0, NULL,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-27', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260441')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260441',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Smith Brothers Stores Ltd'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         142.656, 20.0, 23.78,
         N'Open', NULL, N'Indoor Market, 144-115 Market Square, Stevenage, SG1 1EP', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-28', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260442')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260442',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Green Circles (BC Wiles)'),
         N'S1993 - Coop, Ancaster, Ermine St', N'S1993', N'Coop, Ancaster, Ermine St',
         696.0, 20.0, 116.0,
         N'Open', '2026-04-29', N'Coop Ancaster, 139 Ermine St., Ancaster, Grantham NG32 3QN', 580.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-28', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260443')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260443',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Peterborough'),
         N'S1993 - Coop, Ancaster, Ermine St', N'S1993', N'Coop, Ancaster, Ermine St',
         NULL, 20.0, NULL,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-04-29', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260444')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260444',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Smith Brothers Stores Ltd'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         127.5, 20.0, 21.25,
         N'Open', NULL, N'Indoor Market, 144-115 Market Square, Stevenage, SG1 1EP', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-04-29', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260445')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260445',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         19.95, 0.0, 0.0,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-29', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260446')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260446',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'5099', N'5099', N'Office',
         15.588, 20.0, 2.6,
         N'Open', '2026-04-30', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-29', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260447')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260447',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'12147297 - Babcock B0076', N'12147297', N'Babcock B0076',
         7563.4, 0.0, 0.0,
         N'Open', NULL, N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-30', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260448')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260448',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'C2605758 - Babcock B0077', N'C2605758', N'Babcock B0077',
         5334.22, 0.0, 0.0,
         N'Open', NULL, N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-30', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260449')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260449',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'C2607303 - Babcock B0084', N'C2607303', N'Babcock B0084',
         1173.0, 0.0, 0.0,
         N'Open', NULL, N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-04-30', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260501')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260501',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'F H Brundle'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         441.36, 20.0, 73.56,
         N'Open', '2026-05-06', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-05-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260502')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260502',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1969 - Linford Wood', N'S1969', N'Linford Wood',
         169.2, 20.0, 28.2,
         N'Open', '2026-05-06', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-05-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260503')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260503',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'SRC D11 - Babcock B0035', N'SRC D11', N'Babcock B0035',
         4545.45, 0.0, 0.0,
         N'Open', '2026-05-05', N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260504')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260504',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'Cost Centre 340 - Babcock B0082', N'Cost Centre 340', N'Babcock B0082',
         894.0, 0.0, 0.0,
         N'Open', '2026-05-05', N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260505')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260505',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1982 - Stevenage', N'S1982', N'Stevenage',
         270.0, 20.0, 45.0,
         N'Open', '2026-05-06', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-05-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260506')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260506',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies'),
         N'8099', N'8099', N'Workshop',
         84.456, 20.0, 14.08,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260507')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260507',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         165.996, 20.0, 27.67,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-05', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260508')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260508',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Screwfix'),
         N'8099', N'8099', N'Workshop',
         17.88, 20.0, 2.98,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', GETUTCDATE(), GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260509')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260509',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Trade Point B&Q'),
         N'8099', N'8099', N'Workshop',
         43.068, 20.0, 7.18,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-07', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260510')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260510',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'C2601174 - Babcock B0078', N'C2601174', N'Babcock B0078',
         4860.0, 0.0, 0.0,
         N'Open', '2026-05-08', N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-08', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260511')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260511',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Optima Metal Services'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         285.0, 20.0, 47.5,
         N'Open', '2026-05-10', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Leszek Spychalski', '2026-05-06', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260512')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260512',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'AJN Steelstock'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         8410.8, 20.0, 1401.8,
         N'Open', '2026-05-08', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', 25.0,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-06', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260513')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260513',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         2520.0, 20.0, 420.0,
         N'Open', '2026-05-07', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-07', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260514')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260514',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'PLP Lift Trucks'),
         N'8099', N'8099', N'Workshop',
         NULL, 20.0, NULL,
         N'Open', NULL, NULL, NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-08', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260515')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260515',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'JT Cranes'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         4272.0, 20.0, 712.0,
         N'Open', '2026-05-12', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-08', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260516')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260516',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Green Circles (BC Wiles)'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         840.0, 20.0, 140.0,
         N'Open', '2026-05-11', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-08', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260517')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260517',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'C2607406 - Babcock B0089', N'C2607406', N'Babcock B0089',
         1173.0, 0.0, 0.0,
         N'Open', '2026-05-08', N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-08', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260518')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260518',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BOC Gas & Gear'),
         N'8099', N'8099', N'Workshop',
         NULL, 20.0, NULL,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-11', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260520')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260520',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Green Circles (BC Wiles)'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         2527.2, 20.0, 421.2,
         N'Open', NULL, N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-12', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260521')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260521',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Graitec Limited'),
         N'5099', N'5099', N'Office',
         1068.0, 20.0, 178.0,
         N'Open', '2026-06-13', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260522')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260522',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Autodesk'),
         N'5099', N'5099', N'Office',
         2346.0, 20.0, 391.0,
         N'Open', '2026-06-13', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260523')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260523',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'United Welding Supplies'),
         N'8099', N'8099', N'Workshop',
         399.276, 20.0, 66.55,
         N'Open', '2026-05-14', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Daniel Bojanski', '2026-05-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260524')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260524',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'JT Cranes'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         4752.0, 20.0, 792.0,
         N'Open', '2026-05-18', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-13', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260525')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260525',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Bama South West'),
         N'C2601241 - Babcock B0074', N'C2601241', N'Babcock B0074',
         9932.0, 0.0, 0.0,
         N'Open', '2026-05-15', N'Devonport Dockyard', NULL,
         NULL, NULL, NULL,
         N'Natasza Laucis', '2026-05-15', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260526')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260526',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Orbital Fasteners Ltd'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         360.0, 20.0, 60.0,
         N'Open', NULL, N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-18', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260527')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260527',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Amazon'),
         N'S1998 - Dog Cages', N'S1998', N'Dog Cages',
         154.98, 20.0, 25.83,
         N'Open', '2026-05-20', N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260528')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260528',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'BM Steel'),
         N'S1998 - Dog Cages', N'S1998', N'Dog Cages',
         223.2, 20.0, 37.2,
         N'Open', NULL, N'11 Enterprise Way, Enterprise Park, Peterborough, PE7 3WY', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-19', GETUTCDATE();

IF NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrders WHERE reference = N'P260529')
    INSERT INTO dbo.PurchaseOrders
        (reference, supplier_id, cost_centre, job_number, description,
         total_value, vat_rate, vat_amount,
         status, delivery_date, delivery_address, delivery_charge,
         invoice_ref, invoice_received_at, paid_at,
         created_by, created_at, updated_at)
    SELECT
         N'P260529',
         (SELECT TOP 1 id FROM dbo.Suppliers WHERE supplier_name = N'Brandon Hire Station Reading'),
         N'S1965 - Brookhurst Farm', N'S1965', N'Brookhurst Farm',
         NULL, 20.0, NULL,
         N'Open', '2026-05-20', N'Brookhurst Farm, Holmbury Road, Ewhurst, Cranleigh, GU6 7SJ', NULL,
         NULL, NULL, NULL,
         N'Mateusz Braczyk', '2026-05-19', GETUTCDATE();

PRINT 'Purchase Orders inserted.';

-- ──────────────────────────────────────────────────────────
-- 4. LINK POs TO PROJECTS
-- ──────────────────────────────────────────────────────────
-- Every PO above was inserted with the project reference stuffed into
-- cost_centre + job_number, and project_id NULL — because at the time the
-- import was first written, the matching Projects rows didn't all exist.
--
-- Now that the Projects table is populated (including S-prefix legacy
-- projects), this block links every PO whose job_number matches a real
-- Projects.project_number. It swaps cost_centre -> NULL because the
-- CK_PurchaseOrders_ProjectXorCostCentre check constraint requires
-- exactly one of project_id / cost_centre to be set.
--
-- Idempotent: filters to project_id IS NULL only. Safe to re-run.
-- ──────────────────────────────────────────────────────────

UPDATE po
   SET po.project_id  = p.id,
       po.cost_centre = NULL,
       po.updated_at  = GETUTCDATE()
  FROM dbo.PurchaseOrders po
  JOIN dbo.Projects p ON p.project_number = po.job_number
 WHERE po.project_id IS NULL;

PRINT CONCAT('POs linked to Projects: ', @@ROWCOUNT);
