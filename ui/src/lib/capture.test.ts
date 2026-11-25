import { describe, expect, it } from 'vitest';
import { audioExt, audioFormat, captureBlocked, captureFailure, captureName, handOver, keepAfter, kindOf, kindOfFile, openCamera, openMicrophone, stopStream, videoFormat, type MediaEnv } from './capture';

const env = (over: Partial<MediaEnv> = {}): MediaEnv => ({
  devices: { getUserMedia: async () => ({}) as MediaStream, getDisplayMedia: async () => ({}) as MediaStream },
  allows: () => true,
  recorder: true,
  ...over,
});

describe('captureBlocked', () => {
  it('lets everything start where the browser can and the policy allows', () => {
    for (const kind of ['video', 'photo', 'screenshot'] as const) expect(captureBlocked(kind, env())).toBeNull();
  });

  it('names the policy when the page may not use the camera, and still takes a screenshot', () => {
    const noCamera = env({ allows: (feature) => feature !== 'camera' });
    expect(captureBlocked('video', noCamera)).toBe('policy');
    expect(captureBlocked('photo', noCamera)).toBe('policy');
    expect(captureBlocked('screenshot', noCamera)).toBeNull();
  });

  it('names the policy when the page may not capture the display, and still uses the camera', () => {
    const noScreen = env({ allows: (feature) => feature !== 'display-capture' });
    expect(captureBlocked('screenshot', noScreen)).toBe('policy');
    expect(captureBlocked('photo', noScreen)).toBeNull();
  });

  it('says the browser cannot: no media devices, no way to share a screen, no recorder', () => {
    for (const kind of ['video', 'photo', 'screenshot'] as const) {
      expect(captureBlocked(kind, env({ devices: undefined }))).toBe('unsupported');
    }
    expect(captureBlocked('screenshot', env({ devices: { getUserMedia: async () => ({}) as MediaStream } }))).toBe('unsupported');
    expect(captureBlocked('video', env({ recorder: false }))).toBe('unsupported');
    // A photo needs no recorder.
    expect(captureBlocked('photo', env({ recorder: false }))).toBeNull();
  });
});

describe('videoFormat', () => {
  it('takes the first format the browser can record', () => {
    expect(videoFormat(() => true)).toEqual({ type: 'video/webm;codecs=vp9,opus', ext: 'webm' });
    expect(videoFormat((type) => type === 'video/webm')).toEqual({ type: 'video/webm', ext: 'webm' });
    expect(videoFormat((type) => type === 'video/mp4')).toEqual({ type: 'video/mp4', ext: 'mp4' });
  });

  it('leaves the choice to the browser when it names none', () => {
    expect(videoFormat(() => false)).toEqual({ type: '', ext: 'webm' });
  });
});

describe('captureName', () => {
  it('names the file by what it is and when it was taken, in the time of this computer', () => {
    const at = new Date(2026, 10, 4, 9, 5, 7);
    expect(captureName('video', 'webm', at)).toBe('video-20261104-090507.webm');
    expect(captureName('photo', 'png', at)).toBe('photo-20261104-090507.png');
    expect(captureName('screenshot', 'png', at)).toBe('screenshot-20261104-090507.png');
  });
});

describe('kindOf', () => {
  it('puts a photo with the images', () => {
    expect([kindOf('video'), kindOf('photo'), kindOf('screenshot')]).toEqual(['video', 'image', 'screenshot']);
  });
  it('puts a recording of the microphone with the sounds', () => {
    expect(kindOf('audio')).toBe('audio');
  });
});

describe('a recording of the microphone', () => {
  it('may start where the browser records and the policy lets the page use the microphone', () => {
    expect(captureBlocked('audio', env())).toBeNull();
    expect(captureBlocked('audio', env({ allows: (f) => f !== 'microphone' }))).toBe('policy');
    expect(captureBlocked('audio', env({ allows: (f) => f !== 'camera' }))).toBeNull();
    expect(captureBlocked('audio', env({ recorder: false }))).toBe('unsupported');
    expect(captureBlocked('audio', env({ devices: undefined }))).toBe('unsupported');
  });

  it('takes the first format the browser can record and names its ending', () => {
    expect(audioFormat(() => true)).toEqual({ type: 'audio/webm;codecs=opus', ext: 'webm' });
    expect(audioFormat((t) => t === 'audio/mp4')).toEqual({ type: 'audio/mp4', ext: 'm4a' });
    expect(audioFormat(() => false)).toEqual({ type: '', ext: 'webm' });
    expect(audioExt('audio/ogg;codecs=opus')).toBe('ogg');
    expect(captureName('audio', 'webm', new Date(2026, 10, 25, 9, 5, 7))).toBe('audio-20261125-090507.webm');
  });

  it('asks for the microphone alone', async () => {
    const asked: MediaStreamConstraints[] = [];
    await openMicrophone({ getUserMedia: async (c) => (asked.push(c ?? {}), {} as MediaStream) });
    expect(asked).toEqual([{ audio: true, video: false }]);
  });
});

describe('kindOfFile', () => {
  it('files a video, an image and a recording by what the browser says they are, and nothing else', () => {
    expect(kindOfFile({ type: 'video/mp4' })).toBe('video');
    expect(kindOfFile({ type: 'image/png' })).toBe('image');
    expect(kindOfFile({ type: 'audio/mp4' })).toBe('audio');
    expect(kindOfFile({ type: 'application/pdf' })).toBeUndefined();
    expect(kindOfFile({ type: '' })).toBeUndefined();
  });
});

describe('captureFailure', () => {
  const named = (name: string): Error => Object.assign(new Error(name), { name });

  it('tells a refusal, a missing camera and anything else apart', () => {
    expect(captureFailure('video', named('NotAllowedError'))).toBe('denied');
    expect(captureFailure('photo', named('SecurityError'))).toBe('denied');
    expect(captureFailure('photo', named('NotFoundError'))).toBe('no_device');
    expect(captureFailure('video', named('OverconstrainedError'))).toBe('no_device');
    expect(captureFailure('video', named('NotReadableError'))).toBe('failed');
    expect(captureFailure('video', 'text')).toBe('failed');
  });

  it('takes a closed choice of the screen for a change of mind, not for an error', () => {
    expect(captureFailure('screenshot', named('NotAllowedError'))).toBe('cancelled');
    expect(captureFailure('screenshot', named('AbortError'))).toBe('cancelled');
  });
});

describe('stopStream', () => {
  it('ends every track, and takes no stream for nothing to do', () => {
    const stopped: string[] = [];
    const stream = { getTracks: () => [{ stop: () => stopped.push('a') }, { stop: () => stopped.push('b') }] } as unknown as MediaStream;
    stopStream(stream);
    expect(stopped).toEqual(['a', 'b']);
    stopStream(null);
    stopStream(undefined);
  });
});

const refused = (name: string): Error => Object.assign(new Error(name), { name });

describe('openCamera', () => {
  const devices = (refuseSound: string | null, refuseCamera: string | null) => {
    const asked: MediaStreamConstraints[] = [];
    const stream = {} as MediaStream;
    return {
      asked,
      stream,
      getUserMedia: async (c: MediaStreamConstraints) => {
        asked.push(c);
        if (c.audio && refuseSound) throw refused(refuseSound);
        if (refuseCamera) throw refused(refuseCamera);
        return stream;
      },
    };
  };

  it('records without sound when the microphone is blocked but the camera allowed, or there is no microphone', async () => {
    for (const why of ['NotAllowedError', 'NotFoundError']) {
      const d = devices(why, null);
      expect(await openCamera(d, true)).toBe(d.stream);
      expect(d.asked).toEqual([{ video: true, audio: true }, { video: true, audio: false }]);
    }
  });

  it('tells what the camera alone was refused, and asks nothing again for another failure', async () => {
    const d = devices('NotAllowedError', 'NotAllowedError');
    await expect(openCamera(d, true)).rejects.toMatchObject({ name: 'NotAllowedError' });
    const broken = devices('NotReadableError', null);
    await expect(openCamera(broken, true)).rejects.toMatchObject({ name: 'NotReadableError' });
    expect(broken.asked).toHaveLength(1);
    const quiet = devices(null, null);
    await openCamera(quiet, false);
    expect(quiet.asked).toEqual([{ video: true, audio: false }]);
  });
});

describe('handOver', () => {
  const file = new File(['x'], 'video-20261118-101010.webm', { type: 'video/webm' });
  const taken = { task: 'a/t', file, kind: 'video' as const };

  it('attaches what was taken to its task, and keeps it when the upload fails or another one runs', async () => {
    const sent: unknown[] = [];
    const ok = { uploading: null, attachFile: async (...args: unknown[]) => (sent.push(args), true) };
    expect(await handOver(ok, taken)).toBeNull();
    expect(sent).toEqual([['a/t', file, 'video']]);
    const failing = { uploading: null, attachFile: async () => false };
    expect(await handOver(failing, taken)).toBe(taken);
    const busy = { uploading: 'a/other', attachFile: async () => true };
    expect(await handOver(busy, taken)).toBe(taken);
  });
});

describe('keepAfter', () => {
  const video = { task: 'a/t', file: new File(['v'], 'video.webm'), kind: 'video' as const };
  const photo = { task: 'a/t', file: new File(['p'], 'photo.png'), kind: 'photo' as const };

  it('keeps an earlier recording when a later capture attaches or fails', () => {
    // The video failed and is kept; a photo that attaches leaves it there.
    expect(keepAfter([video], photo, null)).toEqual([video]);
    // A photo that fails as well is kept beside it, not in its place.
    expect(keepAfter([video], photo, photo)).toEqual([video, photo]);
  });

  it('takes a recording off the list once it is attached, and keeps it once when it fails again', () => {
    expect(keepAfter([video, photo], video, null)).toEqual([photo]);
    expect(keepAfter([video, photo], video, video)).toEqual([photo, video]);
    expect(keepAfter([], video, video)).toEqual([video]);
  });
});
