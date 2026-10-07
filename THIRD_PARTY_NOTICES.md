# Third-party notices

AnimeMaker 설치 파일에는 아래 구성요소가 함께 들어갑니다.

| 구성요소 | 용도 | 라이선스 |
|---|---|---|
| [Electron](https://www.electronjs.org/) | 데스크톱 앱 실행 환경 | MIT (Chromium 등 포함 구성요소는 각자의 라이선스, 설치 폴더의 `LICENSES.chromium.html` 참고) |
| [FFmpeg](https://ffmpeg.org/) via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | 영상·음악 처리 | ffmpeg-static 은 GPL-3.0-or-later. 포함된 FFmpeg 바이너리는 GPL 로 빌드되었으며(libx264 등), 소스는 https://ffmpeg.org/download.html 및 바이너리 배포처 안내를 따릅니다. |
| [playwright-core](https://github.com/microsoft/playwright) | 자동 클릭 모드의 브라우저 연결 | Apache-2.0 |

안드로이드 앱(`AnimeMaker-*-android.apk`)에는 아래 구성요소가 함께 들어갑니다.

| 구성요소 | 용도 | 라이선스 |
|---|---|---|
| [Capacitor](https://capacitorjs.com/) (`@capacitor/core`, `android`, `app`, `filesystem`, `clipboard`) | 웹 화면을 안드로이드 앱으로 실행 | MIT |
| [Mediabunny](https://mediabunny.dev/) | 폰 안에서 MP4 읽기·쓰기 (WebCodecs) | MPL-2.0 (수정 없이 사용, 소스: https://github.com/Vanilagy/mediabunny) |
| AndroidX (appcompat, core, coordinatorlayout, webkit 등) | 안드로이드 기본 구성요소 | Apache-2.0 |

이 앱이 실행하는 **Codex CLI, Grok Build CLI, Antigravity CLI, Claude Code** 는 앱에 포함되지 않으며, 사용자가 각 회사의 안내에 따라 직접 설치합니다.
각 CLI 와 AI 서비스의 이용약관은 해당 회사의 정책을 따릅니다.
안드로이드 앱이 글·그림을 보내는 ChatGPT · Gemini · Grok · Claude 앱도 앱에 포함되지 않으며, 사용자가 직접 설치·로그인합니다.
