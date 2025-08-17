// --- Keep-Alive Web Server for Railway/Heroku ---
const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot is running!"));
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Web server running to keep bot alive.");
});


require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, Events
} = require('discord.js');

// ------------ Config ------------
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN || "";
const PREFIX = process.env.PREFIX || "!";
const OWNER_ID = process.env.OWNER_ID || "730629579533844512";
const SPAWN_CHANNEL_ID = process.env.SPAWN_CHANNEL_ID || "";
const PORTAL_MIN_MS = Number(process.env.PORTAL_MIN_MS || 5*60*1000);
const PORTAL_MAX_MS = Number(process.env.PORTAL_MAX_MS || 10*60*1000);

const DATA_FILE = path.join(__dirname, "data.json");

// ------------ Persistent Data ------------
let db = { users:[], market:[], powers:{} };
if (fs.existsSync(DATA_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch {}
}
function saveDB(){ fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2), 'utf8'); }
setInterval(saveDB, 15000);

const users = db.users;
const market = db.market;
const powers = db.powers;

// ------------ Portal Images ------------
const portalImages = [
  "https://i.pinimg.com/564x/1a/0b/f0/1a0bf03b36fd9.jpg",
  "https://i.pinimg.com/564x/92/45/b3/9245b3cc1f9e9.jpg",
  "https://i.pinimg.com/564x/2f/6d/88/2f6d88c88ec1.jpg",
  "https://i.pinimg.com/564x/63/cd/55/63cd55c8.jpg",
  "https://i.pinimg.com/564x/41/23/91/412391a4.jpg"
];
function randomPortalImage(){
  return portalImages[Math.floor(Math.random()*portalImages.length)];
}

// ------------ Helpers ------------
function getUser(id, username){
  let u = users.find(x=>x.userId===id);
  if (!u){
    u = { userId:id, username, level:1, exp:0, gold:0, hpBonus:0, atkBonus:0, createdAt:Date.now(), power:null, inv:{}, hp:120, maxHp:120 };
    users.push(u); saveDB();
  }
  u.maxHp = pMaxHP(u);
  if (u.hp === undefined) u.hp = u.maxHp;
  return u;
}
function pickRandomPower(){
  const keys = Object.keys(powers);
  if (!keys.length) return null;
  const k = keys[Math.floor(Math.random()*keys.length)];
  return { name:k, ...powers[k] };
}
function pMaxHP(u){ return 120 + u.level*30 + (u.hpBonus||0); }
function pATK(u){ return Math.floor(12 + u.level*6 + (u.atkBonus||0)); }

function unlockedSkills(u){
  if (!u.power) return [];
  return (u.power.skills||[]).filter(s => u.level >= (s.levelReq||1));
}
function dmgForSkill(u, sName){
  const skill = (u.power?.skills||[]).find(s=>s.name===sName);
  const mult = skill?.powerMult || 1.0;
  const base = pATK(u);
  return Math.max(1, Math.floor(base * mult * (0.85+Math.random()*0.3)));
}
function addItem(u, key, qty=1){ u.inv ||= {}; u.inv[key]=(u.inv[key]||0)+qty; }
function takeItem(u, key, qty=1){
  u.inv ||= {};
  if ((u.inv[key]||0)<qty) return false;
  u.inv[key]-=qty; if (u.inv[key]<=0) delete u.inv[key]; return true; }
function invToString(u){
  const inv = u.inv||{}; const keys = Object.keys(inv);
  if (!keys.length) return "_empty_";
  return keys.map(k=>`• ${k} x${inv[k]}`).join("\n");
}

// ------------ Item Drops & Consumables ------------
function randomDrops(rarity){
  const lootTable = {
    Common:[{item:"healing_potion", qty:1}],
    Rare:[{item:"mana_potion", qty:1},{item:"iron_sword", qty:1}],
    Epic:[{item:"crystal_shard", qty:2},{item:"enchanted_ring", qty:1}],
    Legendary:[{item:"dragon_scale", qty:1},{item:"phoenix_feather", qty:1}],
    Mythic:[{item:"godstone", qty:1}]
  };
  const pool = lootTable[rarity] || [];
  if (!pool.length) return [];
  const count = rarity==="Mythic" ? 3 : rarity==="Legendary" ? 2 : 1;
  let results=[];
  for(let i=0;i<count;i++){
    results.push(pool[Math.floor(Math.random()*pool.length)]);
  }
  return results;
}

function useItem(u, item){
  if (item==="healing_potion"){
    u.hp = Math.min(u.maxHp||pMaxHP(u), (u.hp||pMaxHP(u)) + 50);
    return `Restored 50 HP. Current HP: ${u.hp}/${u.maxHp||pMaxHP(u)}`;
  }
  if (item==="mana_potion"){
    return `Regained magical energy.`;
  }
  if (item==="xp_scroll"){
    u.exp += 50;
    return `Gained 50 EXP.`;
  }
  return `Used ${item}. (no effect yet)`;
}

// ------------ Battle System ------------
const battles = new Map();
function battleKey(chId, uid){ return `${chId}:${uid}`; }

async function renderBattle(channel, user, b, headline){
  const emb = new EmbedBuilder()
    .setTitle(`⚔️ Battle vs ${b.enemy.name}`)
    .setColor(0x9b59b6)
    .setDescription([
      headline || "",
      "",
      `**${user.username}** — HP: ${b.hp}/${b.maxHp}`,
      `**${b.enemy.name}** — HP: ${b.enemy.hp}/${b.enemy.maxHp}`,
      "",
      b.turn==="player" ? "_Your turn — choose an action below._" : "_Enemy's turn..._"
    ].join("\n"));

  const skills = unlockedSkills(user);
  const perPage = 3;
  const start = b.page*perPage;
  const pageSkills = skills.slice(start, start+perPage);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`battle:attack:${user.userId}`).setLabel("Basic Attack").setStyle(ButtonStyle.Primary)
  );
  for (const s of pageSkills) {
    row1.addComponents(new ButtonBuilder().setCustomId(`battle:skill:${user.userId}:${s.name}`).setLabel(s.name.slice(0,80)).setStyle(ButtonStyle.Success));
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`battle:prev:${user.userId}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`battle:next:${user.userId}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`battle:flee:${user.userId}`).setLabel("Flee").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`battle:item:${user.userId}`).setLabel("Use Item").setStyle(ButtonStyle.Secondary),
  );

  if (b.msg){
    try { await b.msg.edit({ embeds:[emb], components:[row1,row2] }); } catch {}
  } else {
    b.msg = await channel.send({ embeds:[emb], components:[row1,row2] });
  }
}

async function giveBattleRewards(u, rarity){
  const exp = 80 + Math.floor(Math.random()*40);
  const gold = 30 + Math.floor(Math.random()*20);
  u.exp += exp; u.gold = (u.gold||0)+gold;
  while (u.exp >= u.level*100){ u.exp -= u.level*100; u.level++; }
  const drops = randomDrops(rarity||"Common");
  let dropList = [];
  for (const d of drops){ addItem(u,d.item,d.qty); dropList.push(d); }
  saveDB();
  return { exp, gold, drops:dropList };
}

// ------------ Marketplace ------------
function listMarket(){
  return market.map((m,i)=>`${i+1}. ${m.sellerName} sells ${m.qty}x ${m.item} for ${m.gold} Gold`).join("\n") || "_empty_";
}

// ------------ Commands ------------
const client = new Client({ intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials:[Partials.Channel] });

client.on(Events.MessageCreate, async (msg)=>{
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [raw,...rest] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (raw||"").toLowerCase();
  const args = rest;

  if (cmd==="inv"){
    const u = getUser(msg.author.id,msg.author.username);
    const e = new EmbedBuilder().setTitle(`🎒 ${u.username}'s Inventory`).setDescription(invToString(u)).setColor(0x2ecc71);
    return msg.channel.send({embeds:[e]});
  }
  if (cmd==="use"){
    const u=getUser(msg.author.id,msg.author.username);
    const key=(args[0]||"").toLowerCase();
    if(!key) return msg.reply("Usage: !use <item>");
    if(!takeItem(u,key,1)) return msg.reply(`No ${key} available.`);
    const effect=useItem(u,key);
    saveDB();
    return msg.channel.send(effect);
  }
  if (cmd==="forcespawn"){
    if(msg.author.id!==OWNER_ID) return msg.reply("❌ Only the bot owner can use this command.");
    const channel = SPAWN_CHANNEL_ID ? await msg.client.channels.fetch(SPAWN_CHANNEL_ID).catch(()=>null) : msg.channel;
    if(!channel) return msg.reply("No spawn channel configured.");
    await spawnPortal(channel);
    return msg.reply("✅ Portal spawned manually.");
  }
});

// ------------ Interactions ------------
client.on(Events.InteractionCreate, async (ix)=>{
  if (!ix.isButton() && !ix.isStringSelectMenu()) return;
  const parts = ix.customId.split(":");
  const scope = parts[0];

  if (scope==="battle"){
    const [_,action,uid,...extra]=parts;
    const bkey=battleKey(ix.channel.id,uid);
    const b=battles.get(bkey);
    const u=getUser(uid,ix.user.username);
    if(!b||!u) return;
    if(ix.user.id!==uid) return ix.reply({content:"Not your battle.",ephemeral:true});

    if(action==="item"){
      const inv=u.inv||{};
      const options=Object.keys(inv).map(it=>({label:`${it} x${inv[it]}`,value:it}));
      if(!options.length) return ix.reply({content:"No items.",ephemeral:true});
      const menu=new StringSelectMenuBuilder().setCustomId(`useitem:${uid}`).setPlaceholder("Select item").addOptions(options);
      return ix.reply({components:[new ActionRowBuilder().addComponents(menu)],ephemeral:true});
    }
  }
  if(scope==="useitem"){
    const uid=parts[1];
    const u=getUser(uid,ix.user.username);
    const item=ix.values[0];
    if(!takeItem(u,item,1)) return ix.reply({content:`No ${item} left.`,ephemeral:true});
    const effect=useItem(u,item);
    saveDB();
    return ix.reply({content:`Used ${item}: ${effect}`,ephemeral:false});
  }
});

// ------------ Portal Auto-Spawn ------------
async function spawnPortal(channel){
  const rarities=["Common","Rare","Epic","Legendary","Mythic"];
  const rarity=rarities[Math.floor(Math.random()*rarities.length)];
  const emb=new EmbedBuilder().setTitle(`🌌 A ${rarity} Portal Appears!`).setColor(0x3498db).setDescription("A mysterious rift has opened. Brave adventurers may enter!").setImage(randomPortalImage());
  const btn=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("enterportal").setLabel("Enter Portal").setStyle(ButtonStyle.Primary));
  await channel.send({embeds:[emb],components:[btn]});
}

async function portalLoop(client){
  if(!SPAWN_CHANNEL_ID) return;
  const channel = await client.channels.fetch(SPAWN_CHANNEL_ID).catch(()=>null);
  if(!channel) return;
  async function loop(){
    const delay = PORTAL_MIN_MS + Math.random()*(PORTAL_MAX_MS-PORTAL_MIN_MS);
    setTimeout(async()=>{
      await spawnPortal(channel);
      loop();
    }, delay);
  }
  loop();
}

client.once(Events.ClientReady, ()=>{
  console.log(`✅ Logged in as ${client.user.tag}`);
  portalLoop(client);
});

if (!TOKEN) console.log("❌ Missing token."); else client.login(TOKEN);
