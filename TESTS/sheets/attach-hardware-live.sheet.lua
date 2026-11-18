-- The hand check of the attach buttons of a task's detail (and of a plan or project, and of the forms that attach once
-- the thing is made) with what no test sees: the browser's own choice of a screen,
-- a real camera and microphone, real files and the Tauri window. What a machine checks runs elsewhere: ui/e2e (a
-- drawing surface stands for camera and screen, the buttons, the files in assets/, the refusals; and Chrome's own
-- stand-in camera with its question allowed and refused, camera-allowed.spec.ts and camera-refused.spec.ts). The guard
-- lets the hub's page use the camera and the microphone since appkit v0.67.0
-- (tasks-desktop/anhang-video-aufnehmen-und-bild-aufnehmen-freischalten-kamer): the steps of the camera need a build
-- from then on.
--   testing sheets step attach-hardware-live
return {
  id = "tasks-desktop.attach-hardware-live",
  title = "Attach in the detail: real screen choice, camera, microphone, files and the Tauri window",
  task = "tasks-desktop/handtest-anhang-echte-kamera-mikrofon-bildschirm-auswahl-und",
  engine = "manual",
  steps = {
    {
      ask = "Image > Take a screenshot: the browser asks for a screen, window or tab; the picture lands in"
        .. ' assets/screenshots/ of the task, the link is right, and the browser\'s "sharing" bar goes away afterwards?',
    },
    {
      ask = "The choice cancelled: no error message, and the buttons work again?",
    },
    {
      ask = "Attach a file, Upload a video, Upload an image with real files (a video over 100 MB in a git vault: the"
        .. " warning comes)?",
    },
    {
      ask = "The same in the Tauri window: do the file choice and the screenshot work there (WebView2), and if not,"
        .. " what does the page say?",
    },
    {
      ask = "A plan and a project (Plan view, 'Edit links, attachments'): Attach file and Image > From the clipboard"
        .. " of the hub with a real clipboard image; the first one makes plans/<slug>/<slug>.md a folder, the file is"
        .. " listed under Attachments, and the same in the Tauri window?",
    },
    {
      ask = "Create a plan with 'Attach once it is made' (a real file and the clipboard image ticked): after Create"
        .. " both lie in the plan's assets/, and a clipboard without an image takes the newest screenshot or says so?",
    },
    {
      ask = "Video > Record a video with a real camera and microphone (the browser asks, the"
        .. " preview, Stop and attach); the file in assets/videos/ plays with sound?",
    },
    {
      ask = "Image > Take a photo (the browser asks once per origin; preview, picture, file in assets/images/)?",
    },
    {
      ask = "The answer taken back in the browser (the lock or camera sign in the address bar, 'Block'): Record a video"
        .. " and Take a photo say that the camera was not allowed, and allowing it again makes them work?",
    },
    {
      ask = "The request refused, the camera unplugged while recording, a machine"
        .. " without a microphone: the message each time, or a recording without sound?",
    },
    {
      ask = "The light of the camera goes out after Discard, after attaching and after"
        .. " the float is closed?",
    },
  },
}
