-- Add payment terms columns to Suppliers
ALTER TABLE Suppliers
  ADD payment_term_type NVARCHAR(30) NULL,
      payment_term_days INT NULL;
