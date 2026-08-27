import 'dotenv/config';
import express from 'express';
import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

const required = [
  'DISCORD_TOKEN', 'DISCORD_GUILD_ID',
  'TOTAL_CHANNEL_ID', 'ACTIVE_CHANNEL_ID', 'ROBLOX_CHANNEL_ID',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ROBLOX_INGEST_KEY'
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
}

const PORT = Number(process.env.PORT || 3000);
const UPDATE_INTERVAL_MS = Math.max(10_000, Number(process.env.UPDATE_INTERVAL_MS || 15_000));
const ROBLOX_HEARTBEAT_TIMEOUT_MS = Math.max(30_000, Number(process.env.ROBLOX_HEARTBEAT_TIMEOUT_MS || 45_000));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

function safeText(value, max = 100) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'discord-roblox-live-stats', time: new Date().toISOString() });
});

app.post('/roblox/heartbeat', async (req, res) => {
  try {
    const auth = req.get('x-roblox-key');
    if (!auth || auth !== process.env.ROBLOX_INGEST_KEY) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const body = req.body ?? {};
    const jobId = safeText(body.jobId, 128);
    const placeId = String(body.placeId ?? '');
    const playerCount = Number(body.playerCount);

    if (!jobId || !/^\\d+$/.test(placeId) || !Number.isInteger(playerCount) || playerCount < 0 || playerCount > 1000) {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    const { error } = await supabase.from('roblox_servers').upsert({
      job_id: jobId,
      place_id: placeId,
      player_count: playerCount,
      last_seen: new Date().toISOString()
    }, { onConflict: 'job_id' });

    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.post('/roblox/shutdown', async (req, res) => {
  try {
    const auth = req.get('x-roblox-key');
    if (!auth || auth !== process.env.ROBLOX_INGEST_KEY) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const jobId = safeText(req.body?.jobId, 128);
    if (!jobId) return res.status(400).json({ ok: false, error: 'Missing jobId' });

    const { error } = await supabase.from('roblox_servers').delete().eq('job_id', jobId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    console.error('Shutdown error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

let lastRendered = { total: null, active: null, roblox: null };
let updateInProgress = false;

function countActiveMembers(guild) {
  let active = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const status = member.presence?.status;
    if (status && status !== 'offline') active++;
  }
  return active;
}

async function cleanupStaleServers() {
  const cutoff = new Date(Date.now() - ROBLOX_HEARTBEAT_TIMEOUT_MS).toISOString();
  const { error } = await supabase.from('roblox_servers').delete().lt('last_seen', cutoff);
  if (error) throw error;
}

async function getRobloxPlayerCount() {
  const { data, error } = await supabase
    .from('roblox_servers')
    .select('player_count')
    .gte('last_seen', new Date(Date.now() - ROBLOX_HEARTBEAT_TIMEOUT_MS).toISOString());
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + Number(row.player_count || 0), 0);
}

async function updateStats() {
  if (updateInProgress || !client.isReady()) return;
  updateInProgress = true;
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    await guild.members.fetch();
    await cleanupStaleServers();

    const total = guild.memberCount;
    const active = countActiveMembers(guild);
    const roblox = await getRobloxPlayerCount();

    const channels = [
      [process.env.TOTAL_CHANNEL_ID, `👥・Toplam Üye: ${total}`],
      [process.env.ACTIVE_CHANNEL_ID, `🟢・Aktif Üye: ${active}`],
      [process.env.ROBLOX_CHANNEL_ID, `🎮・Oyundaki Kişi: ${roblox}`]
    ];

    const values = { total, active, roblox };
    const changed = lastRendered.total !== total || lastRendered.active !== active || lastRendered.roblox !== roblox;

    if (changed) {
      for (const [channelId, name] of channels) {
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isVoiceBased()) {
          console.warn(`Channel ${channelId} is not a voice channel.`);
          continue;
        }
        if (channel.name !== name) await channel.setName(name, 'Live server statistics update');
      }
      lastRendered = values;
      console.log(`[STATS] Discord=${total} Active=${active} Roblox=${roblox}`);
    }
  } catch (error) {
    console.error('Stats update error:', error);
  } finally {
    updateInProgress = false;
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Guild: ${process.env.DISCORD_GUILD_ID}`);
  await updateStats();
  setInterval(updateStats, UPDATE_INTERVAL_MS);
});

process.on('SIGTERM', () => client.destroy());
process.on('SIGINT', () => client.destroy());

app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server listening on ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
