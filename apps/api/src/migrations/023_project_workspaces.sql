-- Keep path for older desktop clients; new clients manage the full folder list.
-- NULL folders also supports legacy inserts that provide only path.
ALTER TABLE brand_projects ADD COLUMN folders text[];
UPDATE brand_projects SET folders=ARRAY[path];
ALTER TABLE brand_projects ADD CONSTRAINT project_folders_valid CHECK (
  folders IS NULL OR (cardinality(folders) BETWEEN 1 AND 20 AND path=folders[1]
    AND array_position(folders, NULL) IS NULL AND NOT (''=ANY(folders)))
);
ALTER TABLE tasks ADD COLUMN project_id uuid REFERENCES brand_projects(id) ON DELETE SET NULL;
ALTER TABLE routines ADD COLUMN project_id uuid REFERENCES brand_projects(id) ON DELETE SET NULL;
CREATE INDEX tasks_project ON tasks(project_id) WHERE project_id IS NOT NULL;
