const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Buffer } = require('node:buffer');
const mimeType = require('mime-types');

const app = express();
app.use(express.json());
const port = 3000;

const offset = 20 * 1024 * 1024;

const runFfprobeWithStream = (buffer, fromBuffer = true) => {
  return new Promise((resolve, reject) => {
    let ffprobe;
    if (fromBuffer) {
      ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format:stream',
        '-of', 'json',
        '-'
      ]);
     } else {
      ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format:stream',
        '-of', 'json',
        buffer
      ]);
    }

    let output = '';
    let errorOutput = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          const metadata = JSON.parse(output);
          resolve(metadata);
        } catch (parseError) {
          reject(`Error parsing ffprobe output: ${parseError.message}`);
        }
      } else {
        reject(`ffprobe error: ${errorOutput}`);
      }
    });

    ffprobe.stdin.on('error', (err) => {
      console.log('ffprobe stdin error:', err.message);
    });

    ffprobe.stdin.write(buffer);
    ffprobe.stdin.end();
  });
};

const downloadPartial = async (url, rangeStart, rangeEnd) => {
  try {
    const response = await axios.get(url, {
      headers: {
        Range: `bytes=${rangeStart}-${rangeEnd}`,
      },
      responseType: 'arraybuffer',
    });
    return Buffer.from(response.data);
  } catch (error) {
    throw new Error(`Failed to download range ${rangeStart}-${rangeEnd}: ${error.message}`);
  }
};

const metadataFromChunks = async (videoUrl) => {
  try {
    const first4MB = await downloadPartial(videoUrl, 0, 4 * 1024 * 1024 - 1);
    console.log("Extracting metadata from the first 4MB...");
    return await runFfprobeWithStream(first4MB);
  } catch (error) {
    console.log("First attempt failed. Trying with the last 4MB...");
    try {
      const last4MB = await downloadPartial(videoUrl, -4 * 1024 * 1024, '');
      return await runFfprobeWithStream(last4MB);
    } catch (finalError) {
      throw new Error(`Metadata extraction failed: ${finalError.message}`);
    }
  }
};

app.post('/vrok', async (req, res) => {
  const { videoUrl } = req.body;
  console.log('Trying for videoUrl: ', videoUrl);

  if (!videoUrl) {
    return res.status(400).json({
      success: false,
      message: 'videoUrl is required'
    });
  }

  try {
    const fileType = mimeType.lookup(videoUrl);
    if (fileType === "video/x-msvideo"){
      const res = await runFfprobeWithStream(videoUrl, false);
      res.json({
        success: true,
        fileType,
        metadata: res
      });
    } else {
      const metadata = await metadataFromChunks(videoUrl);
      res.json({
        success: true,
        fileType,
        metadata
      });
    }
  } catch (error) {
    console.log('Error fetching video metadata:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Start the server (Example port)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
