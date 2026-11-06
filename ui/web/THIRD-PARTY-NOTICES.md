# Third-party notices

The pages in this repository are built by [tasks-desktop](https://github.com/WKDSteve/tasks-desktop) and bundle the code
below; each page also carries this text as a comment. The versions come from the lockfile of the build (`ui/web/notices.mjs`).

| Component | Version | License | In |
| --- | --- | --- | --- |
| Lua (compiled to WebAssembly by wasmoon) | 5.4 | MIT | tasks.html, engine-check.html |
| wasmoon | 1.16.0 | MIT | tasks.html, engine-check.html |
| Emscripten runtime (JavaScript glue inside wasmoon) | as built by wasmoon | MIT | tasks.html, engine-check.html |
| inspect.lua (as vim.inspect of Neovim 0.12.2) | 3.1.0 | MIT | tasks.html, engine-check.html |
| Svelte (client runtime) | 5.57.1 | MIT | tasks.html |
| clsx (dependency of the Svelte runtime) | 2.1.1 | MIT | tasks.html |
| markdown-it | 15.0.3 | MIT | tasks.html |
| linkify-it | 6.1.0 | MIT | tasks.html |
| mdurl | 2.1.0 | MIT | tasks.html |
| uc.micro | 3.0.0 | MIT | tasks.html |
| punycode.js | 2.3.1 | MIT | tasks.html |
| entities | 8.1.0 | BSD-2-Clause | tasks.html |

First-party code in the pages, all MIT, Copyright (c) 2026 Stefan Bartl: tasks-desktop (UI, worker, `vim` shim), appkit
(`appkit-ui`), and the Lua engine tasks.nvim with lib.nvim. The case-mapping table of the `vim` shim is generated from
Neovim `vim.fn.tolower` (data, not code). `probe.html` contains no third-party code.

## Copyright notices

- Lua (compiled to WebAssembly by wasmoon): Copyright (C) 1994-2024 Lua.org, PUC-Rio.
- wasmoon: Copyright (c) 2023 Gabriel Francisco.
- Emscripten runtime (JavaScript glue inside wasmoon): Copyright (c) 2010-2014 Emscripten authors, see the AUTHORS file of Emscripten.
- inspect.lua (as vim.inspect of Neovim 0.12.2): Copyright (c) 2013 Enrique Garcia Cota.
- Svelte (client runtime): Copyright (c) 2016-2025 Svelte Contributors.
- clsx (dependency of the Svelte runtime): Copyright (c) Luke Edwards (lukeed.com).
- markdown-it: Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.
- linkify-it: Copyright (c) 2015 Vitaly Puzrin.
- mdurl: Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin; parts Copyright Joyent, Inc. and other Node contributors.
- uc.micro: Copyright Mathias Bynens.
- punycode.js: Copyright Mathias Bynens.
- entities: Copyright (c) Felix Boehm.

## MIT License (all components above except entities)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## BSD 2-Clause License (entities)

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list
of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this
list of conditions and the following disclaimer in the documentation and/or other
materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR
BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
ANY WAY OUT OF THE USE OF THIS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
