<script lang="ts">
  // The buttons of a task's detail that attach something to it: a file from this computer, a video (a file, or
  // recorded with the camera), an image (a file, a photo with the camera, a picture of the screen, or the image on
  // the clipboard of the hub's machine). Whatever is taken here goes the way of every file from the page: through the
  // hub's upload to the engine, which puts it into the folder of its kind (`assets/videos/`, `assets/images/`,
  // `assets/screenshots/`). An entry the page may not start (no camera for it, a browser that cannot) says why.
  import { onDestroy, tick, untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import {
    captureBlocked,
    captureFailure,
    captureName,
    frameOf,
    kindOf,
    kindOfFile,
    mediaEnv,
    playing,
    stopStream,
    videoFormat,
    type AssetKind,
    type Blocked,
    type Capture,
  } from '../lib/capture';
  import { translate, type Key } from '../lib/i18n';
  import ChoiceMenu, { type Choice } from './ChoiceMenu.svelte';

  let { app, id }: { app: App; id: string } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  let filePicker: HTMLInputElement | undefined = $state();
  let videoPicker: HTMLInputElement | undefined = $state();
  let imagePicker: HTMLInputElement | undefined = $state();
  const busy = $derived(app.locked || app.uploading !== null);

  function picked(input: HTMLInputElement, kind?: AssetKind): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) void app.attachFile(id, file, kind ?? kindOfFile(file));
  }

  // What is being taken now: the camera shown for a photo, or a video being recorded. A screenshot needs no panel.
  let taking = $state<{ kind: 'video' | 'photo'; ready: boolean } | null>(null);
  let preview: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let action: HTMLButtonElement | undefined = $state();

  function reasonOf(blocked: Blocked | null): string | undefined {
    return blocked === null ? undefined : t(`attach.capture.${blocked}` as Key);
  }
  // Asked when the choice is drawn: the policy of a page does not change while it is shown.
  const env = mediaEnv();
  const blocked = {
    video: captureBlocked('video', env),
    photo: captureBlocked('photo', env),
    screenshot: captureBlocked('screenshot', env),
  };

  /** An entry that cannot be chosen was pressed: its reason is told where every message of the page is. */
  function toldWhy(choice: Choice): void {
    const kind = choice.id === 'video-record' ? 'video' : choice.id === 'image-photo' ? 'photo' : 'screenshot';
    const why = blocked[kind];
    if (why !== null) app.tell('error', `attach.capture.${why}` as Key);
  }

  // Every start of a capture is a session of its own. Whatever comes back late (the browser's answer to a question
  // that was discarded meanwhile, the last piece of a recording, a picture) belongs to the session that asked: one
  // that is over stops what it got and attaches nothing, and never ends the session that came after it.
  let session = 0;

  function end(): void {
    session += 1;
    if (recorder) {
      // Also when it has stopped already: its last events are still on their way.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    recorder = null;
    stopStream(stream);
    stream = null;
    if (preview) preview.srcObject = null;
    taking = null;
  }

  function failed(kind: Capture, error: unknown): void {
    end();
    const why = captureFailure(kind, error);
    if (why !== 'cancelled') app.tell('error', `attach.capture.${why}` as Key);
  }

  /** What was taken becomes a file of the task it was taken for; one file at a time, and a second one is told. */
  function attach(task: string, file: File, kind: Capture): void {
    if (app.uploading !== null) {
      app.tell('error', 'attach.capture.busy');
      return;
    }
    void app.attachFile(task, file, kindOf(kind));
  }

  /** The camera with the sound where the page may use the microphone; a machine without one records without sound. */
  async function camera(sound: boolean): Promise<MediaStream> {
    const devices = env.devices as MediaDevices;
    if (!sound) return devices.getUserMedia({ video: true, audio: false });
    try {
      return await devices.getUserMedia({ video: true, audio: true });
    } catch (error) {
      if (captureFailure('video', error) !== 'no_device') throw error;
      return devices.getUserMedia({ video: true, audio: false });
    }
  }

  /** The camera, shown in the panel: for a photo, or with a recorder that runs from now on for a video. */
  async function startCamera(kind: 'video' | 'photo'): Promise<void> {
    if (taking !== null || busy) return;
    taking = { kind, ready: false };
    session += 1;
    const mine = session;
    const task = id;
    let got: MediaStream | null = null;
    try {
      got = await camera(kind === 'video' && env.allows('microphone'));
      // Discarded, or another capture started, while the browser asked: this camera goes off again at once.
      if (mine !== session) {
        stopStream(got);
        return;
      }
      stream = got;
      await tick();
      if (!preview) throw new Error('no preview');
      await playing(preview, got);
      if (mine !== session) return;
      if (kind === 'video') {
        const format = videoFormat((type) => MediaRecorder.isTypeSupported(type));
        const parts: Blob[] = [];
        const running = new MediaRecorder(got, format.type === '' ? undefined : { mimeType: format.type });
        recorder = running;
        running.ondataavailable = (event) => {
          if (event.data.size > 0) parts.push(event.data);
        };
        // The end of the recording, asked for ("Stop and attach") or not (the camera was unplugged): what was
        // recorded becomes the file either way, so nothing a person recorded is thrown away by an accident.
        running.onstop = () => {
          if (mine !== session) return;
          const type = running.mimeType;
          end();
          if (parts.length === 0) {
            app.tell('error', 'attach.capture.failed');
            return;
          }
          const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
          attach(task, new File(parts, captureName('video', ext, new Date()), { type: type || 'video/webm' }), 'video');
        };
        running.onerror = () => {
          if (mine === session) failed('video', new Error('recorder'));
        };
        running.start();
      }
      taking = { kind, ready: true };
      await tick();
      action?.focus();
    } catch (error) {
      // A session that is over has been cleaned up by whoever ended it: only its own camera is left to switch off.
      if (mine !== session) stopStream(got);
      else failed(kind, error);
    }
  }

  /** The recording ends and becomes a file of the task (`onstop` of the recorder does the rest). */
  function stopVideo(): void {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  /** The picture the camera shows now becomes a file of the task. */
  async function takePhoto(): Promise<void> {
    if (!preview || !taking?.ready) return;
    const mine = session;
    const task = id;
    try {
      const blob = await frameOf(preview);
      if (mine !== session) return;
      end();
      attach(task, new File([blob], captureName('photo', 'png', new Date()), { type: 'image/png' }), 'photo');
    } catch (error) {
      if (mine === session) failed('photo', error);
    }
  }

  /** The browser asks which screen or window; one picture of it becomes a file of the task. */
  async function takeScreenshot(): Promise<void> {
    if (taking !== null || busy) return;
    session += 1;
    const mine = session;
    const task = id;
    let shared: MediaStream | null = null;
    try {
      shared = await (env.devices as MediaDevices).getDisplayMedia({ video: true, audio: false });
      if (mine !== session) return;
      const video = document.createElement('video');
      await playing(video, shared);
      const blob = await frameOf(video);
      video.srcObject = null;
      // The detail shows another task by now, or is gone: the picture was meant for the one that asked.
      if (mine !== session) return;
      attach(task, new File([blob], captureName('screenshot', 'png', new Date()), { type: 'image/png' }), 'screenshot');
    } catch (error) {
      if (mine === session) failed('screenshot', error);
    } finally {
      stopStream(shared);
    }
  }

  const videoChoices = $derived<Choice[]>([
    { id: 'video-upload', label: t('attach.video.upload'), onselect: () => videoPicker?.click() },
    { id: 'video-record', label: t('attach.video.record'), reason: reasonOf(blocked.video), onselect: () => void startCamera('video') },
  ]);
  const imageChoices = $derived<Choice[]>([
    { id: 'image-upload', label: t('attach.image.upload'), onselect: () => imagePicker?.click() },
    { id: 'image-photo', label: t('attach.image.photo'), reason: reasonOf(blocked.photo), onselect: () => void startCamera('photo') },
    {
      id: 'image-screenshot',
      label: t('attach.image.screenshot'),
      reason: reasonOf(blocked.screenshot),
      onselect: () => void takeScreenshot(),
    },
    // The image on the clipboard of the machine the hub runs on, else its newest screenshot (the engine reads both).
    { id: 'image-clipboard', label: t('attach.image.clipboard'), onselect: () => void app.attachScreenshot(id) },
  ]);

  // Another task in the same detail, or the detail gone: the camera goes off, nothing is attached.
  $effect(() => {
    void id;
    return () => untrack(end);
  });
  onDestroy(end);
</script>

<span class="attach-bar" role="group" aria-label={t('attach.group')}>
  <button
    type="button"
    class="attach"
    data-attach="file"
    data-hint={t('hint.ui.detail.attach_file')}
    disabled={busy || taking !== null}
    onclick={() => filePicker?.click()}>{app.uploading === id ? t('attach.uploading') : t('attach.file')}</button
  >
  <ChoiceMenu
    name="video"
    label={t('attach.video')}
    hint={t('hint.ui.detail.attach_video')}
    choices={videoChoices}
    disabled={busy || taking !== null}
    onblocked={toldWhy}
  />
  <ChoiceMenu
    name="image"
    label={t('attach.image')}
    hint={t('hint.ui.detail.attach_image')}
    choices={imageChoices}
    disabled={busy || taking !== null}
    onblocked={toldWhy}
  />
  <input
    type="file"
    class="picker"
    data-file-picker
    tabindex="-1"
    aria-hidden="true"
    bind:this={filePicker}
    onchange={(e) => picked(e.currentTarget)}
  />
  <input
    type="file"
    class="picker"
    accept="video/*"
    data-video-picker
    tabindex="-1"
    aria-hidden="true"
    bind:this={videoPicker}
    onchange={(e) => picked(e.currentTarget, 'video')}
  />
  <input
    type="file"
    class="picker"
    accept="image/*"
    data-image-picker
    tabindex="-1"
    aria-hidden="true"
    bind:this={imagePicker}
    onchange={(e) => picked(e.currentTarget, 'image')}
  />
</span>
{#if taking}
  <div class="taking" role="group" aria-label={t(taking.kind === 'video' ? 'attach.video.record' : 'attach.image.photo')} data-taking={taking.kind}>
    <!-- The camera's own picture, without sound: nothing to caption. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={preview} playsinline muted aria-label={t('attach.capture.preview')}></video>
    <p class="state" role="status">
      {#if !taking.ready}
        {t('attach.capture.starting')}
      {:else if taking.kind === 'video'}
        <span class="dot" aria-hidden="true">●</span> {t('attach.capture.recording')}
      {:else}
        {t('attach.capture.ready')}
      {/if}
    </p>
    <p class="actions">
      {#if taking.kind === 'video'}
        <button type="button" class="attach go" bind:this={action} disabled={!taking.ready || app.uploading !== null} onclick={stopVideo}
          >{t('attach.capture.stop')}</button
        >
      {:else}
        <button type="button" class="attach go" bind:this={action} disabled={!taking.ready || app.uploading !== null} onclick={() => void takePhoto()}
          >{t('attach.capture.take')}</button
        >
      {/if}
      <button type="button" class="attach" onclick={end}>{t('attach.capture.discard')}</button>
    </p>
  </div>
{/if}

<style>
  .attach-bar {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    vertical-align: top;
  }
  .attach {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.7rem;
    cursor: pointer;
  }
  .attach.go {
    border-color: var(--accent);
  }
  .picker {
    display: none;
  }
  .taking {
    margin-top: 0.5rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    max-width: 24rem;
  }
  .taking video {
    display: block;
    width: 100%;
    max-height: 14rem;
    border-radius: var(--radius);
    background: var(--bg);
  }
  .state {
    margin: 0.4rem 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .dot {
    color: var(--bad);
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    margin: 0;
  }
</style>
