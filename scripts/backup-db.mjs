import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const dbPath = path.join(cwd, 'predictions.json');
const backupDir = path.join(cwd, 'backups');
const keep = Number(process.env.DB_BACKUP_KEEP || 7);

if (!fs.existsSync(dbPath)) {
  console.log('No predictions.json file found. Skipping backup.');
  process.exit(0);
}

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `predictions-${stamp}.json`);
fs.copyFileSync(dbPath, backupPath);

const backups = fs
  .readdirSync(backupDir)
  .filter((file) => file.startsWith('predictions-') && file.endsWith('.json'))
  .sort();

while (backups.length > keep) {
  const oldest = backups.shift();
  if (!oldest) break;
  fs.unlinkSync(path.join(backupDir, oldest));
}

console.log(`Backup created: ${backupPath}`);
