-- 028_data_shares (down)
DROP TRIGGER IF EXISTS trg_data_shares_no_delete ON data_shares;
DROP TABLE IF EXISTS data_shares;
