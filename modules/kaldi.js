const MemoryStream = new require('memory-stream');
var sox = require('sox-stream');
var { exec } = require("child-process-promise");
var fs = require("fs");
const knex = require('knex')({ client: 'sqlite3' });
let path = require('path');

var db;

const kaldiPath = "../Kaldi_NL/";
const kaldiTempPath = "../Kaldi_NL/discordbot/";

module.exports = {
  init(database){
    db = database;
  },
  process: function(stream, username, servername){
    var audioStream = new MemoryStream();
    try{
      this.convertsox(stream, audioStream);
    }catch(err){
      console.log("Error bij " . username);
    }

    audioStream.on('finish', () => {
      let audioBuffer = audioStream.toBuffer();
      const audioLength = (audioBuffer.length / 2) * (1 / 8000);

      if(audioLength > 1.5){
        console.log("Processing...");
        let filename =  username + "_" + new Date().toISOString();

        fs.writeFileSync("queued/" + filename + ".wav", audioBuffer);
        this.handleFile(username, filename, servername);
      }else{
        console.log("Skipped");
      }
    })
  },
  convertsox: function(inputstream, outputstream){
    let options = {
      global: {
        'no-dither': true,
        'ignore-length': true,
        'guard': true
      },
      input: {
        type: "raw",
        encoding: "signed-integer",
        b: 16,
        endian: "little",
        channels: 2,
        rate: 48000,
      },
      output: {
        b: 16,
        rate: 8000,
        channels: 1,
        encoding: 'signed-integer',
        compression: 0.0,
        endian: 'little',
        type: 'wav'
      }
    }
    inputstream.pipe(sox(options)).pipe(outputstream);
  },
  async handleFile(username, filename, servername){
    //create
    let kaldiDir = kaldiTempPath + filename;
    fs.mkdirSync(kaldiDir);
    //Convert and move file with sox
    let sourceFile = "queued/" + filename + ".wav"; 
    let destFile = kaldiDir + "/audio.wav";
    await exec(`sox ${sourceFile} ${destFile}`);
    //Run decode
    await exec(`cd ${kaldiPath} && ./decode_GN.sh discordbot/${filename}/audio.wav discordbot/${filename}`);
    //Get transcript
    let transcriptPath = kaldiDir + "/1Best.ctm";
    if(!fs.existsSync(transcriptPath)){
      console.log("File not created!");
      this.cleanup(sourceFile, kaldiDir);
      return;
    }
    
    let rawTransscript = fs.readFileSync(transcriptPath).toString("utf-8");
    if(rawTransscript.trim().length === 0){
      console.log("Empty file found");
      this.cleanup(sourceFile, kaldiDir);
      return;
    }
    let splitTranscript = rawTransscript.split("\n").map(line => line.split(" "));

    //map each word
    let wordObject = splitTranscript.reduce((acc, wordTranscript) => {
      let [,,start, length, word, accuracy] = wordTranscript;
      if(parseFloat(accuracy) > 0.5 && (!acc[word] || parseFloat(acc[word].accuracy) < parseFloat(accuracy))){
        acc[word] = {start, length, accuracy};
      }
      return acc;
    }, {});
    
    console.log(wordObject);
    //isolate words and save them in the database
    await Promise.all(Object.entries(wordObject).map(([word, {start, length, accuracy}]) => {
      return (async () => {
        //cut
        await exec(`ffmpeg -ss ${start} -t ${length} -i ${kaldiDir}/audio.wav ${kaldiDir}/${word}.wav`);
        //Read
        let data = fs.readFileSync(`${kaldiDir}/${word}.wav`).toString("base64");
        //Put it in the database
        let query = knex("Words").insert({
          server_name: servername,
          username,
          word,
          score: parseFloat(accuracy),
          audio_data: data
        }).toString();

        db.exec(query);
      })();
    }));

    this.cleanup(sourceFile, kaldiDir);
  },
  cleanup(sourceFile, kaldiDir){
    fs.rmdirSync(path.join(process.cwd(), kaldiDir), { recursive: true });
    fs.unlinkSync(path.join(process.cwd(), sourceFile));
  }
}