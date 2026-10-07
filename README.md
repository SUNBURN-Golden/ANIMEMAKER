# AnimeMaker – AI 뮤직비디오 자동 제작기 (Windows · Android)

**Suno 등으로 만든 노래 파일과 가사**를 올리면, 이미 구독 중인 AI(ChatGPT · SuperGrok · Google AI(Gemini) · Claude)를 불러와서
스토리보드 → 박자에 맞춘 컷 설계(10~15컷, 컷당 1~30초) → 키프레임 → 영상 클립 → **가사 자막과 노래를 입힌 3~4분 완성본**까지 자동으로 만들어 주는 윈도우 프로그램입니다.

> 🔒 **구독 전용**: API 키(쓴 만큼 돈이 나가는 종량제)를 쓰지 않습니다. 각 회사의 공식 프로그램(CLI)에 **구독 계정으로 로그인**해서 쓰고,
> 실행할 때 API 키 환경변수를 자동으로 지워 실수로 과금되는 일을 막습니다. 사용 한도에 걸리면 기다렸다가 이어서 합니다.

## 어떻게 만들어지나요?

| 단계 | 하는 일 | 담당 |
|---|---|---|
| 1. 노래·가사 | 올린 노래(mp3/wav/m4a/mp4)의 길이·**BPM·박자·마디 자동 분석**, 가사 읽기(Suno 구간 태그, .lrc/.srt 지원) | 내 PC (무료) |
| 2. 기획 | 가사와 노래 구조(벌스·후렴)에 맞춘 스토리보드, 시나리오, 등장인물 | 구독 LLM (오케스트레이터) |
| 3. 타이밍 설계 | 가사 자막 시간 맞추기(탭 또는 자동/가사 파일 시간), **박자 위에서만** 컷 10~15개(각 1~30초)로 나누기, 컷마다 장면·화면전환 확정 | 내 PC + 구독 LLM |
| 4. 키프레임 | 캐릭터 기준 그림 → 컷마다 첫 장면 그림 ("문장 구조 틀"로 프롬프트 조립) | ChatGPT 이미지(Codex) / Grok Imagine / Gemini 웹 |
| 5. 영상 클립 | 키프레임을 컷 길이만큼 영상으로. 영상 AI 는 한 번에 15초까지라 **더 긴 컷은 마지막 장면에서 이어 만들어 붙임** | Grok Imagine(grok CLI) / 웹 |
| 6. 최종 편집 | 화면전환으로 이어붙이기 + **하단 가사 자막** + 노래 깔기 → MP4, SRT/LRC | 내 PC (무료, ffmpeg) |

영상 길이 = 올린 노래 길이입니다. 노래는 Suno 등에서 따로 만들어 올립니다(이 앱은 노래를 만들지 않습니다).

## 구독별로 되는 것 (2026년 10월 기준)

| 구독 | 공식 프로그램 | 자동으로 되는 것 |
|---|---|---|
| ChatGPT Plus/Pro/Business | Codex CLI (`codex`) | 기획 글쓰기, 키프레임 이미지(`$imagegen`, gpt-image) |
| SuperGrok / X Premium+ | Grok Build CLI (`grok`) | 기획 글쓰기, 이미지(image_gen), **이미지→영상(image_to_video)** |
| Google AI Pro/Ultra | Antigravity CLI (`agy`) | 기획 글쓰기 (Gemini CLI 개인 로그인은 2026-06-18 종료되어 Antigravity 로 대체) |
| Claude Pro/Max | Claude Code (`claude`) | 기획 글쓰기 |

Gemini 의 **Veo 영상·나노바나나 이미지**, Grok Imagine 웹처럼 웹에서만 되는 기능은 두 가지 방법으로 처리합니다.

- **도우미 모드 (기본)**: 앱이 프롬프트/가사를 복사해 주고 사이트를 열어 줍니다. 사용자가 만들고 **다운로드만 하면** 다운로드 폴더를 지켜보다가 자동으로 가져와 제자리에 넣습니다.
- **자동 클릭 (실험적, 기본 꺼짐)**: PC 의 Edge/Chrome 을 전용 프로필로 열어 사람 속도로 대신 누릅니다. 로그인은 사용자가 그 창에서 직접 한 번 합니다.
  - ⚠ 대부분의 AI 서비스 약관은 자동화된 방식의 이용을 금지·제한합니다. **계정 제한 위험이 있고 책임은 사용자에게 있습니다.** 켤 때 동의 창이 뜹니다.
  - CAPTCHA 를 풀거나 봇 탐지를 우회하는 기능은 넣지 않았습니다. 막히면 그 항목만 도우미 모드로 넘어갑니다.
  - 사이트 화면이 바뀌면 [AI 연결 설정 → 고급: 자동 클릭 레시피] 에서 클릭 위치(선택자)를 고칠 수 있습니다.

## 설치 (Windows 10/11)

1. GitHub 저장소의 **Actions → "Windows 설치 파일 만들기" → 가장 최근 실행 → Artifacts → `AnimeMaker-Windows`** 를 내려받아 압축을 풉니다.
   (태그 `v0.1.0` 처럼 릴리스를 만들면 **Releases** 에도 올라갑니다.)
2. `AnimeMaker-…-nsis.exe`(설치형) 또는 `AnimeMaker-…-portable.exe`(설치 없이 실행)를 실행합니다.
3. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** 을 누릅니다. (코드 서명이 없는 개인 프로그램이라 뜨는 안내입니다)

## 처음 사용하기

1. 첫 화면에서 **[체험 모드로 먼저 구경하기]** → 노래 없이 바로 시작하면 예시 노래와 가짜 그림으로 전체 흐름을 볼 수 있습니다. (무료)
2. **[AI 연결 설정]** 에서 가진 구독 카드의 **[설치하기] → [로그인 하기] → [연결 테스트]** 를 차례로 누릅니다.
   - Codex 는 Node.js 가 필요합니다(https://nodejs.org). 로그인 창에서 **"Sign in with ChatGPT"** 를 고르세요. (API key 로그인은 종량제)
3. 같은 화면의 **빠른 설정**에서 내 구독 조합(예: ⭐ ChatGPT + SuperGrok)을 누릅니다.
4. **[새 영상 만들기]** 에서 ① 노래 파일 올리기 → ② 가사 붙여넣기(또는 .txt/.lrc/.srt 불러오기) → ③ 영상 컨셉(선택) → ④ 워크플로우 → **[▶ 뮤직비디오 만들기 시작]**.
5. 기획이 끝나면 **"⌨ 가사 자막 시간 맞추기"** 카드가 뜹니다. 노래를 들으며 줄마다 스페이스바를 누르면(노래 길이만큼 걸림) 자막과 컷이 가사에 딱 맞습니다. 건너뛰면 자동 추정으로 진행합니다. (.lrc/.srt 처럼 시간이 든 가사면 이 단계 없음)
6. 도우미 모드 단계에서는 노란 **"🙋 도와주세요"** 카드가 뜨면 안내대로 복사 → 사이트에서 생성 → 다운로드만 하면 됩니다.

### 다듬기

- **가사 싱크**: [노래·가사·타이밍] 탭 → **⌨ 탭으로 가사 맞추기** → 노래를 들으며 줄이 시작될 때 스페이스바. 저장 후 "자막만 다시 입히기".
- **BPM 이 두 배/절반으로 잡힘**: 같은 탭에서 BPM 을 고치고 다시 분석.
- **그림/영상 하나만 다시**: [키프레임]/[영상 클립] 탭에서 ✏️ 다시 (프롬프트 수정 가능) 또는 📁 교체 → [완성 영상] 탭에서 다시 만들기.
- **워크플로우**: 그림체, 화면 비율(9:16/16:9/1:1/4:5), 컷 수(기본 10~15)·길이(기본 1~30초)·템포, 화면전환 스타일, 자막 모양, 문장 구조 틀, 확인 단계를 저장해 두고 재사용.

## 📱 안드로이드 앱 (폰 혼자 다 하는 버전)

PC 없이 폰 하나로 같은 흐름을 따라갑니다. 설치 파일: GitHub Actions 의 **AnimeMaker-Android** 결과물(`AnimeMaker-<버전>-android.apk`)
→ 폰에서 열기 → "출처를 알 수 없는 앱 설치 허용" 을 한 번 켜고 설치 (안드로이드 7 이상, 영상 만들기는 Android System WebView/Chrome 최신 버전 권장).

1. **노래·가사**: Suno 노래 파일을 고르고(또는 Suno 앱에서 공유 → AnimeMaker) 가사를 붙여 넣습니다. 박자(BPM)·마디 분석은 폰 안에서 합니다.
2. **이야기 · 장면 설계**: [부탁하기] 를 누르면 부탁 글이 **ChatGPT · Gemini · Grok · Claude 앱**으로 바로 들어갑니다. 답장을 길게 눌러 복사하고 돌아오면 자동으로 읽습니다.
3. **컷 나누기**: PC 판과 같은 계산으로 박자·가사에 맞춰 10~15컷. [탭으로 가사 맞추기] 로 자막 시간을 정확히 맞출 수 있습니다.
4. **그림**: 컷마다 [부탁하기] → AI 앱에서 그림이 나오면 **공유 → AnimeMaker** (또는 갤러리에 저장 후 [사진 고르기]). 캐릭터 기준 그림을 먼저 만들면 부탁할 때 같이 보내 같은 주인공을 유지합니다.
5. **움직이기 (선택)**: 그대로 두면 그림이 천천히 확대되며 움직이고, 원하면 컷마다 Grok·Gemini 영상으로 부탁해 진짜 움직이는 영상으로 바꿉니다.
6. **완성**: 컷 + 박자에 맞춘 화면전환 + 가사 자막 + 노래를 **폰 안에서 MP4 로 합칩니다**(폰의 영상 인코더 사용, 인터넷·서버 필요 없음). 갤러리(동영상/AnimeMaker)에 저장하거나 바로 공유합니다.

- 🔒 폰 앱도 **구독 전용**입니다. 유료 API 를 부르지 않고, 내 폰에 설치된 공식 AI 앱으로 글·그림을 주고받기만 합니다.
- 🧪 [체험해 보기] 를 누르면 AI 없이 1분짜리 연습 영상을 끝까지 만들어 흐름을 익힐 수 있습니다.
- 작품은 앱 안 저장소에만 있습니다. 앱을 지우면 함께 지워지니, 완성 영상은 갤러리에 저장해 두세요.

## 결과물 위치

`문서\AnimeMaker\<날짜 주제>\`
- `output\<제목>.mp4` – 완성 영상 (파일 정보에 "AI 생성" 표시)
- `output\lyrics.srt`, `lyrics.lrc` – 가사 자막 파일, `storyboard.md` – 기획안·샷 리스트
- `keyframes\`, `clips\`, `music\` – 중간 결과물 / `log.txt` – 진행 기록 / `work\` – AI 프로그램 원본 출력

## 주의사항

- 실존 인물, 유명 캐릭터, 기존 노래 가사를 주제로 쓰지 마세요. (기획 지시문에도 "오리지널만" 을 넣어 두었습니다)
- 유튜브·틱톡 등은 사실적인 AI 생성 콘텐츠에 표시를 요구합니다. 업로드할 때 해당 옵션을 켜세요.
- 각 서비스의 이용약관과 생성물 이용 조건(상업적 이용 가능 여부 등)을 확인하세요.

## 개발자용

```bash
npm install        # Electron, ffmpeg-static, playwright-core
npm start          # 앱 실행
npm test           # 단위·통합 테스트 (가짜 CLI 와 가짜 웹사이트로 실제 AI 없이 검증)
npm run dist:win   # Windows 설치 파일 (Windows 에서 실행 권장, CI 가 자동으로 만듦)
```

```
src/main/
  main.js, preload.js          Electron 창 · IPC
  store.js, defaults.js        설정 · 워크플로우 · 프로젝트 저장
  pipeline/runner.js           6단계 오케스트레이션 (재시도, 구독 한도 대기, 도우미 대기, 이어서 하기)
  pipeline/prompts.js          오케스트레이터 지시문 · 문장 구조 틀 조립
  ai/cli.js, ai/agents.js      구독 CLI 실행 (API 키 제거, 결과 파일 탐지)
  ai/helper.js                 도우미 모드 (다운로드 폴더 감시)
  ai/webbot/                   자동 클릭 (Edge/Chrome CDP + 레시피)
  ai/demo.js, ai/demo-data.js  체험 모드 (demo-data 는 폰 앱과 공용)
  media/audio.js               노래 읽기 (ffmpeg) → audio-analysis.js 로 BPM · 박자 · 마디 분석 (폰 앱과 공용)
  media/lyrics.js              가사 읽기 (Suno 구간 태그, .lrc, .srt)
  media/timeline.js            가사 타이밍 · 박자 단위 컷 나누기(DP) · 전환 길이
  media/assemble.js            ffmpeg 이어붙이기 · xfade 전환 · 자막 · 노래
  subtitles.js                 가사 자막 PNG (맑은 고딕)
src/renderer/                  화면 (한국어 UI)
```

안드로이드 앱 (`mobile/`, Capacitor + 웹 화면):

```bash
cd mobile
npm install
npm test           # 계산 단위 테스트 + Chromium 으로 화면을 끝까지 눌러 MP4 확인 (CHROME_PATH 로 브라우저 지정 가능)
npm run apk        # www 묶기 → cap sync → gradlew assembleDebug (JDK 21, Android SDK 36 필요. CI 가 자동으로 만듦)
```

```
mobile/src/
  pipeline.js        작업 순서 (PC 의 prompts · timeline · lyrics · audio-analysis 를 그대로 사용)
  audio.js, analyze.worker.js   노래 읽기 + 박자 분석 (Worker)
  render.js          WebCodecs(Mediabunny) 로 컷·전환·자막·노래 → MP4
  transitions.js, subtitles.js  화면전환 · 가사 자막 그리기
  native.js          AI 앱으로 보내기 · 공유 받기 · 갤러리 저장 (안드로이드 플러그인 연결)
  db.js              작품·파일 저장 (IndexedDB)
  main.js, project.js, tap.js, ui.js   화면
mobile/android/app/src/main/java/com/animemaker/mobile/AnimeMakerNativePlugin.java   안드로이드 전용 기능
```

서드파티 구성요소는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 를 참고하세요.
