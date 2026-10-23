-- brand_category_review_view was created directly in the database (not
-- through migrations). This file documents the live definition for version
-- control. No behavior change — this CREATE OR REPLACE VIEW matches what is
-- already live, now exposing crc.id as category_review_id (its last column)
-- so dismiss/undismiss code paths can match rows by id instead of by name.

CREATE OR REPLACE VIEW public.brand_category_review_view AS
 SELECT bca.brand_id,
    COALESCE(r_direct.id, r_map.id) AS retailer_id,
    crc.retailer_name,
    crc.retailer_category_review_name,
    crc.universal_department,
    crc.universal_category,
    crc.review_date,
    crc.reset_date,
    crc.id AS category_review_id
   FROM brand_category_access bca
     JOIN category_review_calendar crc ON lower(TRIM(BOTH FROM crc.universal_category)) = lower(TRIM(BOTH FROM bca.universal_category))
     LEFT JOIN retailers r_direct ON lower(TRIM(BOTH FROM r_direct.name)) = lower(TRIM(BOTH FROM crc.retailer_name)) OR lower(TRIM(BOTH FROM COALESCE(r_direct.banner, ''::text))) = lower(TRIM(BOTH FROM crc.retailer_name))
     LEFT JOIN retailer_review_mapping rrm ON lower(TRIM(BOTH FROM rrm.retailer_name)) = lower(TRIM(BOTH FROM crc.retailer_name)) AND lower(TRIM(BOTH FROM COALESCE(rrm.retailer_category_review_name, ''::text))) = lower(TRIM(BOTH FROM COALESCE(crc.retailer_category_review_name, ''::text))) AND lower(TRIM(BOTH FROM rrm.universal_category)) = lower(TRIM(BOTH FROM crc.universal_category))
     LEFT JOIN retailers r_map ON r_map.id = rrm.retailer_id;
