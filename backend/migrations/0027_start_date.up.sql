-- Stage 20: Timeline view needs a start date alongside the due date.
ALTER TABLE issues ADD COLUMN start_date DATE;
