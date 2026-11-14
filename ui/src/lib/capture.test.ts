import { describe, expect, it } from 'vitest';
import { captureBlocked, captureFailure, captureName, kindOf, kindOfFile, stopStream, videoFormat, type MediaEnv } from './capture';

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
});

describe('kindOfFile', () => {
  it('files a video and an image by what the browser says they are, and nothing else', () => {
    expect(kindOfFile({ type: 'video/mp4' })).toBe('video');
    expect(kindOfFile({ type: 'image/png' })).toBe('image');
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
