const Discord = require('discord.js');
const client = new Discord.Client();
const kaldi = require("./modules/kaldi");
const Database = require('better-sqlite3');
const db = new Database('database.db');
const knex = require('knex')({ client: 'sqlite3' });
const { Readable } = require('stream');
var sox = require('sox-stream');
const MemoryStream = new require('memory-stream');

const SegfaultHandler = require('segfault-handler');
const { SSL_OP_TLS_ROLLBACK_BUG } = require('constants');
SegfaultHandler.registerHandler('crash.log');

kaldi.init(db);

const discordToken = process.env.DISCORD_TOKEN;

client.login(discordToken);

client.on('ready', () => {
  client.user.setPresence({ activity: { name: 'an innocent fbi agent' }, status: 'idle' })
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', async (msg) => {
  if (msg.content === '*join') {
    const voiceChannel = msg.guild.channels.cache.find(channel => channel.type === "voice" && channel.members.has(msg.author.id));
    const conn = await voiceChannel.join();

    conn.on("speaking", (user, speaking) => speaking && listenSpeak(conn, msg, user, msg.guild.name));
  }

  if (msg.content.substring(0, 5) === '*play') {
    let voiceChannel = msg.guild.channels.cache.find(channel => channel.type === "voice" && channel.members.has(client.user.id));
    if(!voiceChannel){
      voiceChannel = msg.guild.channels.cache.find(channel => channel.type === "voice" && channel.members.has(msg.author.id));
    }
    const conn = await voiceChannel.join();
    
    handleTextToSpeech(msg.content.substring(6, msg.content.length), conn);
  }

  if (msg.content.substring(0, 5) === '*list') {
    let words = listWords().sort().join(", ");
    for(let i = 0; i < words.length; i += 2000) {
      await msg.channel.send(words.substring(i, i + 2000));
    }
  }
});

function listWords(){
  let query = knex("Words").select(knex.raw("DISTINCT(word) as word")).toString();
  
  let statement = db.prepare(query);
  const data = statement.all();

  return data.map(({word}) => word);
}

function handleTextToSpeech(text, conn){
  //break words
  const words = text.trim().split(" ").filter(word => word.length !== 0);
  //generate query
  const query = knex.select(
    "word",
    "audio_data"
  ).from(knex.select("*").from("Words").orderBy(knex.raw("random()")))
  .whereIn("word", words)
  .groupBy("word")
  .toString();

  const statement = db.prepare(query);
  const data = statement.all();

  const sortedData = words.reduce((acc, word) => {
    acc.push(data.find((row) => row.word === word));
    return acc;
  }, []);
  let buffers = sortedData.map(row =>  Buffer.from(row.audio_data, 'base64'));


  let fullLength = 0;
  for(let buffer of buffers){
    const audioLength = (buffer.length / 2) * (1 / 8000);
    setTimeout(() => playBuffer(conn, buffer), fullLength + 500);

    fullLength += audioLength * 1000;
  }
}

function playBuffer(conn, buffer){
  const stream = Readable.from(buffer);
  var audioStream = new MemoryStream();
  convertsoxback(stream, audioStream); 

  audioStream.on('finish', () => {
    let buffer = audioStream.toBuffer()
    let stream = Readable.from(buffer);SSL_OP_TLS_ROLLBACK_BUG
    conn.play(stream, {type: "converted"});
  })
}

async function listenSpeak(conn, msg, user, servername) {
  if(user.username === "Groovy" || user.username === "Blerp") return false;
  console.log(`I'm listening to ${user.username}`);

  const audioStream = conn.receiver.createStream(user, { mode: "pcm", end: "silence" });
  kaldi.process(audioStream, user.username, servername);
}

function convertsoxback(inputstream, outputstream){
  let options = {
    global: {
      'ignore-length': true,
      'guard': true
    },
    input: {
      type: "wav",
      encoding: "signed-integer",
      b: 16,
      endian: "little",
      channels: 1,
      rate: 8000,
    },
    output: {
      b: 16,
      rate: 48000,
      channels: 2,
      encoding: 'signed-integer',
      compression: 0.0,
      endian: 'little',
      type: 'raw'
    }
  }
  inputstream.pipe(sox(options)).pipe(outputstream);
}