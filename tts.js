const { createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

const DICT_PATH = path.join(__dirname, 'dictionary.json');

// 辞書の読み込み
function loadDictionary() {
  if (!fs.existsSync(DICT_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

// テキストを辞書で置換する
function applyDictionary(text) {
  const dict = loadDictionary();
  let replacedText = text;
  for (const [key, value] of Object.entries(dict)) {
    // ユーザー名やURLなどを除外するため、単純な文字列置換を行う
    const regex = new RegExp(key, 'g');
    replacedText = replacedText.replace(regex, value);
  }
  return replacedText;
}

async function processQueue(guildId, readingSessions) {
  const session = readingSessions.get(guildId);
  if (!session || session.isPlaying || session.queue.length === 0) return;

  session.isPlaying = true;
  const rawText = session.queue.shift();
  const textToRead = applyDictionary(rawText);

  try {
    const encodedText = encodeURIComponent(textToRead);
    const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=ja&client=tw-ob`;

    const resource = createAudioResource(audioUrl);
    session.audioPlayer.play(resource);

    session.audioPlayer.once(AudioPlayerStatus.Idle, () => {
      session.isPlaying = false;
      processQueue(guildId, readingSessions);
    });

  } catch (error) {
    console.error('Google音声読み上げエラー:', error);
    session.isPlaying = false;
    processQueue(guildId, readingSessions);
  }
}

function saveDictionary(dict) {
  fs.writeFileSync(DICT_PATH, JSON.stringify(dict, null, 2), 'utf8');
}

module.exports = { processQueue, loadDictionary, saveDictionary };