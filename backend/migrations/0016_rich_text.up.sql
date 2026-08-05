ALTER TABLE issues   ADD COLUMN description_doc JSONB;
ALTER TABLE comments ADD COLUMN body_doc        JSONB;
