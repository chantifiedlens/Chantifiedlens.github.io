// Exact topic rules, evaluated independently in this display order. No name/description guessing.
export const icons = {
  fabric: { file: 'fabric_48_color.png', alt: 'Microsoft Fabric', width: 512, height: 512 },
  github: { file: 'GitHub_Invertocat_Black.png', alt: 'GitHub', width: 294, height: 288 },
  devops: { file: '10261-icon-service-Azure-DevOps.svg', alt: 'Azure DevOps', width: 18, height: 18 },
  synapse: { file: '00606-icon-service-Azure-Synapse-Analytics.svg', alt: 'Azure Synapse Analytics', width: 18, height: 18 },
  sql: { file: '10130-icon-service-SQL-Database.svg', alt: 'Azure SQL Database', width: 18, height: 18 }
};

export const technologies = [
  { id: 'fabric', name: 'Microsoft Fabric', description: 'Analytics, data engineering and delivery workflows on one platform.', icon: 'fabric', accent: 'green' },
  { id: 'synapse', name: 'Azure Synapse Analytics', description: 'Practical automation for your analytics workspace.', icon: 'synapse', accent: 'blue' },
  { id: 'sql-server', name: 'SQL Server', description: 'Repeatable workflows for SQL Server solutions.', accent: 'violet' },
  { id: 'azure-sql', name: 'Azure SQL Database', description: 'Cloud database solutions with automated delivery.', icon: 'sql', accent: 'blue' },
  { id: 'other', name: 'Other repositories', description: 'More tools, experiments and examples worth exploring.', accent: 'slate' }
];

export const categories = [
  { id: 'fabric-actions', technology: 'fabric', platform: 'GitHub Actions', title: 'Microsoft Fabric solutions using GitHub Actions', path: 'fabric/github-actions', all: ['microsoft-fabric', 'github-actions'], icons: ['fabric', 'github'] },
  { id: 'fabric-devops', technology: 'fabric', platform: 'Azure DevOps', title: 'Microsoft Fabric solutions using Azure DevOps', path: 'fabric/azure-devops', all: ['microsoft-fabric', 'azure-devops'], icons: ['fabric', 'devops'] },
  { id: 'fabric-misc', technology: 'fabric', platform: 'Miscellaneous', title: 'Miscellaneous Microsoft Fabric repositories', path: 'fabric/miscellaneous', all: ['microsoft-fabric'], none: ['github-actions', 'azure-devops'], icons: ['fabric'] },
  { id: 'synapse-actions', technology: 'synapse', platform: 'GitHub Actions', title: 'Azure Synapse Analytics solutions using GitHub Actions', path: 'synapse/github-actions', all: ['azure-synapse-analytics', 'github-actions'], icons: ['synapse', 'github'] },
  { id: 'synapse-devops', technology: 'synapse', platform: 'Azure DevOps', title: 'Azure Synapse Analytics solutions using Azure DevOps', path: 'synapse/azure-devops', all: ['azure-synapse-analytics', 'azure-devops'], icons: ['synapse', 'devops'] },
  { id: 'sql-server-actions', technology: 'sql-server', platform: 'GitHub Actions', title: 'SQL Server solutions using GitHub Actions', path: 'sql-server/github-actions', all: ['github-actions'], any: ['sqlserver', 'sql-server'], icons: ['github'] },
  { id: 'sql-server-devops', technology: 'sql-server', platform: 'Azure DevOps', title: 'SQL Server solutions using Azure DevOps', path: 'sql-server/azure-devops', all: ['azure-devops'], any: ['sqlserver', 'sql-server'], icons: ['github'] },
  { id: 'azure-sql-actions', technology: 'azure-sql', platform: 'GitHub Actions', title: 'Azure SQL Database solutions using GitHub Actions', path: 'azure-sql/github-actions', all: ['azure-sql-database', 'github-actions'], icons: ['sql', 'github'] },
  { id: 'other', technology: 'other', platform: 'Other', title: 'Other repositories', path: 'other', fallback: true, icons: [] }
];

export function matchesCategory(topics, category) {
  const set = new Set(topics);
  return !category.fallback && (category.all ?? []).every(t => set.has(t))
    && (!(category.any?.length) || category.any.some(t => set.has(t)))
    && (category.none ?? []).every(t => !set.has(t));
}

export function classify(topics, definitions = categories) {
  const normalized = [...new Set((Array.isArray(topics) ? topics : [])
    .filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()))];
  const matches = definitions.filter(c => matchesCategory(normalized, c));
  return (matches.length ? matches : definitions.filter(c => c.fallback)).map(c => c.id);
}