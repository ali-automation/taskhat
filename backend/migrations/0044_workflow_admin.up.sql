-- Stage 26b: admin workflows directory needs a "last edited" stamp.
ALTER TABLE workflows ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
