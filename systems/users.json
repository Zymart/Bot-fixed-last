
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '../data.json');

let db = { users: [] };
if (fs.existsSync(DATA_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
}
function saveDB() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8'); }
setInterval(saveDB, 15000);

function getUser(id, username) {
  let u = db.users.find(x => x.userId === id);
  if (!u) {
    u = { userId: id, username, level: 1, exp: 0, gold: 0, hp: 120, maxHp: 120 };
    db.users.push(u); saveDB();
  }
  return u;
}
module.exports = { getUser };
