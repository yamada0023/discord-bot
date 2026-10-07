const { createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');

async function processQueue(guildId, readingSessions) {
  const session = readingSessions.get(guildId);
  if (!session || session.isPlaying || session.queue.length === 0) return;

  session.isPlaying = true;
  const textToRead = session.queue.shift();

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

module.exports = { processQueue };