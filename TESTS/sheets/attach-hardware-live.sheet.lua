-- The hand check of the attach buttons of a task's detail with what no test sees: the browser's own choice of a screen,
-- a real camera and microphone, real files and the Tauri window. What a machine checks runs elsewhere: ui/e2e (a
-- drawing surface stands for camera and screen, the buttons, the files in assets/, the refusals). Video and photo are
-- only choosable once the guard lets the hub's page use the camera
-- (tasks-desktop/anhang-video-aufnehmen-und-bild-aufnehmen-freischalten-kamer); skip those steps until then.
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
      ask = "Once the camera is released: Record a video with a real camera and microphone (the browser asks, the"
        .. " preview, Stop and attach); the file in assets/videos/ plays with sound?",
    },
    {
      ask = "Once the camera is released: Take a photo (preview, picture, file in assets/images/)?",
    },
    {
      ask = "Once the camera is released: the request refused, the camera unplugged while recording, a machine"
        .. " without a microphone: the message each time, or a recording without sound?",
    },
    {
      ask = "Once the camera is released: the light of the camera goes out after Discard, after attaching and after"
        .. " the float is closed?",
    },
  },
}
