#!/usr/bin/env bash
# Makes the media the end-to-end tests import: ffmpeg test patterns with a
# tone, small enough to commit. Run it from anywhere: `bash e2e/fixtures/make-fixtures.sh`.
# Needs ffmpeg with libx264, libvpx-vp9, libopus, libmp3lame and prores_ks (Homebrew's has them).
set -euo pipefail
cd "$(dirname "$0")"

quiet=(-y -hide_banner -loglevel error)
# Leave out the creation time and the encoder's name, so a rerun changes as little as it can.
plain=(-map_metadata -1 -fflags +bitexact)

# A tone that swells twice a second, so the waveform has a shape: left at 440 Hz, right at 660 Hz.
swell="0.55+0.45*sin(2*PI*1.5*t)"
tone="0.7*sin(2*PI*440*t)*($swell)|0.7*sin(2*PI*660*t)*($swell)"

# 05-wide.mp4: the clip the design's bin shows (0:05 · 1920 × 1080 · 24 fps). H.264 High and AAC,
# with a keyframe every 2 s like a camera's. Also the 1080p clip the import is timed with.
ffmpeg "${quiet[@]}" \
  -f lavfi -i "testsrc=size=1920x1080:rate=24:duration=5" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=5" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -preset slow -crf 36 -g 48 \
  -c:a aac -b:a 48k -ac 2 -movflags +faststart \
  "${plain[@]}" 05-wide.mp4

# pattern-30fps.mp4: 3 s at 30 fps, smaller.
ffmpeg "${quiet[@]}" \
  -f lavfi -i "testsrc=size=640x360:rate=30:duration=3" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=3" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -preset slow -crf 32 -g 60 \
  -c:a aac -b:a 48k -ac 2 -movflags +faststart \
  "${plain[@]}" pattern-30fps.mp4

# pattern-25fps.webm: VP9 and Opus at 25 fps, 2 s.
ffmpeg "${quiet[@]}" \
  -f lavfi -i "testsrc=size=640x360:rate=25:duration=2" \
  -f lavfi -i "sine=frequency=550:sample_rate=48000:duration=2" \
  -c:v libvpx-vp9 -pix_fmt yuv420p -crf 40 -b:v 0 -g 50 -row-mt 1 \
  -c:a libopus -b:a 32k -ac 2 \
  "${plain[@]}" pattern-25fps.webm

# prores.mov: six frames of Apple ProRes 422 Proxy, which no browser decodes: "Can't open".
ffmpeg "${quiet[@]}" \
  -f lavfi -i "testsrc=size=320x180:rate=24:duration=0.25" \
  -c:v prores_ks -profile:v 0 -pix_fmt yuv422p10le \
  "${plain[@]}" prores.mov

# tone.mp3 (3 s), tone.wav (2 s) and tone.m4a (2 s, AAC): stereo music for A1.
ffmpeg "${quiet[@]}" -f lavfi -i "aevalsrc=$tone:s=44100:d=3" -c:a libmp3lame -b:a 96k "${plain[@]}" tone.mp3
ffmpeg "${quiet[@]}" -f lavfi -i "aevalsrc=$tone:s=16000:d=2" -c:a pcm_s16le "${plain[@]}" tone.wav
ffmpeg "${quiet[@]}" -f lavfi -i "aevalsrc=$tone:s=44100:d=2" -c:a aac -b:a 64k "${plain[@]}" tone.m4a

# not-video.mp4: text with a video's name, for "there's no video or audio in it".
printf 'This is a text file with a video file name.\n' > not-video.mp4

# frame-index.mp4: every frame shows its own index, so a test can read back which frame is on
# screen. The picture is a grid of 4 × 2 blocks of 160 × 180 px; block k
# (left to right, then the second row) is white when bit k of the frame's index is set, black when
# it isn't. 4 s at 24 fps, 96 frames, H.264 High with a key frame every 12 frames and B-frames, so
# stepping and seeking go through the decoder's reordering, as a camera's files do.
index="if(bitand(N\,pow(2\,floor(X/160)+4*floor(Y/180)))\,235\,16)"
ffmpeg "${quiet[@]}" \
  -f lavfi -i "color=c=black:size=640x360:rate=24:duration=4" \
  -vf "geq=lum='$index':cb=128:cr=128,format=yuv420p" \
  -c:v libx264 -profile:v high -preset slow -crf 18 -g 12 -bf 3 -movflags +faststart \
  "${plain[@]}" frame-index.mp4

# frame-index-30fps.webm: the same at 30 fps for 2 s, in WebM, which stores times in whole
# milliseconds: frame 2 (66.67 ms) is stored as 67 ms, after it starts.
ffmpeg "${quiet[@]}" \
  -f lavfi -i "color=c=black:size=640x360:rate=30:duration=2" \
  -vf "geq=lum='$index':cb=128:cr=128,format=yuv420p" \
  -c:v libvpx-vp9 -crf 30 -b:v 0 -g 15 -row-mt 1 \
  "${plain[@]}" frame-index-30fps.webm

# broken.mp4: 3 s of test pattern whose file stops partway into the key frame at 2 s, like a
# download that didn't finish. It imports (its first frame decodes) but playback can't get past
# 2 s: "Can't decode broken.mp4 here".
ffmpeg "${quiet[@]}" \
  -f lavfi -i "testsrc=size=640x360:rate=24:duration=3" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -preset slow -crf 30 -g 24 -movflags +faststart \
  "${plain[@]}" whole.mp4
cut=$(ffprobe -v error -select_streams v -show_entries packet=pts_time,pos -of csv=p=0 whole.mp4 |
  awk -F, '$1 == "2.000000" { print $2 + 1000 }')
head -c "$cut" whole.mp4 > broken.mp4
rm whole.mp4

# story-shot.mp4: the clip the e2e tests serve for every Feed clip's address, its 1080p original
# and its 720p file alike: 5 s at 24 fps, 120 frames, each showing its index
# as in frame-index.mp4, with B-frames like the Feed's. A key frame every second, where the Feed's
# have one per clip: each of a clip's six thumbnails then decodes one frame, so the story's 15
# filmstrips don't keep a slow CI runner's decoder busy under the tests (the benches measure the
# Feed's own clips).
ffmpeg "${quiet[@]}" \
  -f lavfi -i "color=c=black:size=640x360:rate=24:duration=5" \
  -vf "geq=lum='$index':cb=128:cr=128,format=yuv420p" \
  -c:v libx264 -profile:v high -preset slow -crf 18 -g 24 -keyint_min 24 -sc_threshold 0 -bf 2 \
  -movflags +faststart "${plain[@]}" story-shot.mp4

# feed/poster.jpg: the poster the e2e tests serve for every Feed card. Homebrew's ffmpeg has no WebP
# encoder, so it's a JPEG, served as one under the cards' .webp addresses.
mkdir -p feed
ffmpeg "${quiet[@]}" -f lavfi -i "testsrc=size=320x180:rate=1:duration=1" -frames:v 1 -q:v 8 \
  "${plain[@]}" feed/poster.jpg

ls -l 05-wide.mp4 pattern-30fps.mp4 pattern-25fps.webm prores.mov tone.mp3 tone.wav tone.m4a \
  not-video.mp4 frame-index.mp4 frame-index-30fps.webm broken.mp4 story-shot.mp4 feed/poster.jpg
