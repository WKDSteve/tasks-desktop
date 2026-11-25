// Taking a video, a photo or a screenshot in the page, to attach it to a task (views/AttachBar.svelte). The browser
// does the taking (`getUserMedia`, `getDisplayMedia`, `MediaRecorder`) and asks the person itself; this file says
// beforehand whether the page may ask at all, names the file, and turns a stream into a picture.

/** What is taken: a video or a photo with the camera, a picture of a screen or a window, or a recording of the microphone. */
export type Capture = 'video' | 'photo' | 'screenshot' | 'audio';

/** The folder of the task an attached file goes to (the engine's `attach` with `kind`); none: `assets/` itself. */
export type AssetKind = 'video' | 'image' | 'screenshot' | 'audio';

/** What the page has to take with; `window` in a browser, a double in a test. */
export interface MediaEnv {
  /** `navigator.mediaDevices`, or undefined where the browser has none (a page without a secure context). */
  devices: Partial<Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>> | undefined;
  /** Whether the policy of the page lets it use a feature (`camera`, `microphone`, `display-capture`). */
  allows: (feature: string) => boolean;
  /** Whether a video can be recorded at all (`MediaRecorder`). */
  recorder: boolean;
}

/** Why a capture cannot be started: the browser cannot, or the policy of the page (the hub's) does not let it. */
export type Blocked = 'unsupported' | 'policy';

/**
 * Whether `kind` can be started in `env`, and why not. A video and a photo need the camera, a screenshot the capture
 * of the display. `null` means the page may ask; the person can still say no, and there may be no camera.
 */
export function captureBlocked(kind: Capture, env: MediaEnv): Blocked | null {
  if (kind === 'screenshot') {
    if (typeof env.devices?.getDisplayMedia !== 'function') return 'unsupported';
    return env.allows('display-capture') ? null : 'policy';
  }
  if (typeof env.devices?.getUserMedia !== 'function') return 'unsupported';
  if ((kind === 'video' || kind === 'audio') && !env.recorder) return 'unsupported';
  return env.allows(kind === 'audio' ? 'microphone' : 'camera') ? null : 'policy';
}

/** The policy of a document: Chrome's `featurePolicy`, or the newer name of it. */
interface PolicyHolder {
  permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
  featurePolicy?: { allowsFeature?: (feature: string) => boolean };
}

/**
 * The environment of this page. A browser that cannot be asked about its policy (Firefox) is taken to allow: the
 * capture is tried, and what the browser refuses is told then.
 */
export function mediaEnv(): MediaEnv {
  // No document: the component is drawn outside a browser (a test that renders it to text); nothing can be taken there.
  const doc = (typeof document === 'undefined' ? {} : document) as unknown as PolicyHolder;
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;
  return {
    devices: typeof navigator === 'undefined' ? undefined : navigator.mediaDevices,
    allows: (feature) => {
      try {
        return typeof policy?.allowsFeature === 'function' ? policy.allowsFeature(feature) : true;
      } catch {
        return true;
      }
    },
    recorder: typeof MediaRecorder === 'function',
  };
}

/** The formats a video is recorded in, best first; the browser takes the first it can. */
export const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] as const;

/** The format to record in and the ending of its file; an empty type leaves the choice to the browser (`webm`). */
export function videoFormat(supported: (type: string) => boolean): { type: string; ext: string } {
  const type = VIDEO_TYPES.find((candidate) => supported(candidate)) ?? '';
  return { type, ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
}

/** The formats a recording of the microphone is made in, best first; the browser takes the first it can. */
export const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const;

/** The format to record sound in and the ending of its file; an empty type leaves the choice to the browser (`webm`). */
export function audioFormat(supported: (type: string) => boolean): { type: string; ext: string } {
  const type = AUDIO_TYPES.find((candidate) => supported(candidate)) ?? '';
  return { type, ext: audioExt(type) };
}

/** The ending of a recorded sound by the type the recorder made (it may differ from the one asked for). */
export function audioExt(type: string): string {
  return type.startsWith('audio/mp4') ? 'm4a' : type.startsWith('audio/ogg') ? 'ogg' : 'webm';
}

/** The microphone alone, for a recording of sound. */
export function openMicrophone(devices: Pick<MediaDevices, 'getUserMedia'>): Promise<MediaStream> {
  return devices.getUserMedia({ audio: true, video: false });
}

const two = (n: number): string => String(n).padStart(2, '0');

/** The name of a file that was taken at `at` (the time of this computer): `video-20261114-153012.webm`. */
export function captureName(kind: Capture, ext: string, at: Date): string {
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  const time = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `${kind}-${day}-${time}.${ext}`;
}

/** The folder a file somebody chose or dropped goes to, by what the browser says it is; none for anything else. */
export function kindOfFile(file: { type: string }): AssetKind | undefined {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  // a recording or a dictation (a meeting's, a task's): `assets/audio/`
  if (file.type.startsWith('audio/')) return 'audio';
  return undefined;
}

/** The folder a taken file goes to: a photo is an image, a recording of the microphone a sound (`assets/audio/`). */
export function kindOf(kind: Capture): AssetKind {
  return kind === 'photo' ? 'image' : kind;
}

/**
 * What a failed start is told as: the person or the system said no (`denied`), there is no camera (`no_device`), the
 * person closed the choice of the screen (`cancelled`: a screenshot only, nothing to tell), or something else.
 */
export function captureFailure(kind: Capture, error: unknown): 'denied' | 'no_device' | 'cancelled' | 'failed' {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return kind === 'screenshot' ? 'cancelled' : 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_device';
  if (name === 'AbortError') return 'cancelled';
  return 'failed';
}

/** Every track of a stream ended: the camera's light goes out, the browser's "sharing" bar goes. */
export function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * One picture of what `video` shows now, as a PNG. The element must be playing the stream; a stream that has no
 * picture yet (no size) is none.
 */
export function frameOf(video: HTMLVideoElement): Promise<Blob> {
  const { videoWidth: width, videoHeight: height } = video;
  if (width === 0 || height === 0) return Promise.reject(new Error('the stream has no picture yet'));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.reject(new Error('no canvas'));
  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no picture'))), 'image/png');
  });
}

/** `video` plays `stream` and has a picture: resolved when its size is known, rejected after `timeout` ms. */
export function playing(video: HTMLVideoElement, stream: MediaStream, timeout = 5000): Promise<void> {
  video.srcObject = stream;
  video.muted = true;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the stream shows nothing')), timeout);
    const check = (): void => {
      if (video.videoWidth > 0 && video.readyState >= 2) {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', check);
        video.removeEventListener('resize', check);
        resolve();
      }
    };
    video.addEventListener('loadeddata', check);
    video.addEventListener('resize', check);
    void video.play().then(check, () => undefined);
    check();
  });
}

/**
 * The camera, with the sound when `sound`. When the camera with the microphone is refused (the microphone is blocked
 * while the camera is allowed, or there is none), it is asked once more without sound: a video without sound is
 * better than none. What the camera alone is refused is the error then.
 */
export async function openCamera(devices: Pick<MediaDevices, 'getUserMedia'>, sound: boolean): Promise<MediaStream> {
  if (!sound) return devices.getUserMedia({ video: true, audio: false });
  try {
    return await devices.getUserMedia({ video: true, audio: true });
  } catch (error) {
    const why = captureFailure('video', error);
    if (why !== 'no_device' && why !== 'denied') throw error;
    return devices.getUserMedia({ video: true, audio: false });
  }
}

/** A file that was taken for `task` and is not attached yet. */
export interface Taken {
  task: string;
  file: File;
  kind: Capture;
}

/** What the keeper needs of the page: its upload, and whether one runs. */
export interface CaptureHost {
  uploading: string | null;
  attachFile(id: string, file: File, kind?: AssetKind): Promise<boolean>;
}

/**
 * Hands what was taken to the upload; what is not attached (another upload runs, the disk is full, the hub is gone)
 * comes back to be kept: a recording is not taken again as easily as a file is chosen again. The page offers it to be
 * sent again or saved on this computer until it is attached or discarded. `null`: attached.
 */
export async function handOver(host: CaptureHost, taken: Taken): Promise<Taken | null> {
  if (host.uploading !== null) return taken;
  return (await host.attachFile(taken.task, taken.file, kindOf(taken.kind))) ? null : taken;
}

/**
 * What is kept after `sent` went to the upload and `back` came back of it: `sent` leaves the list (attached, or kept
 * anew as `back`), every other recording that was kept stays. A capture that attaches does not take an earlier one
 * that is still waiting with it.
 */
export function keepAfter(kept: readonly Taken[], sent: Taken, back: Taken | null): Taken[] {
  const rest = kept.filter((k) => k.file !== sent.file);
  return back === null ? rest : [...rest, back];
}
