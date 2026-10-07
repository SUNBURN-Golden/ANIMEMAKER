'use strict';
/* 사용 방법 */
(function (AM) {
  const { h } = AM;
  AM.views = AM.views || {};

  AM.views.help = function help() {
    const link = (label, url) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.api.openExternal(url); } }, label);
    return h('div', { class: 'help' },
      h('h1', { class: 'page-title' }, '❓ 사용 방법'),
      h('p', { class: 'page-sub' }, 'LLM 을 처음 써 보는 분도 따라 할 수 있게 정리했어요.'),

      h('div', { class: 'section' },
        h('h3', null, '처음 한 번만 하면 되는 준비'),
        h('ol', null,
          h('li', null, h('b', null, '체험 모드로 구경하기: '), '[새 영상 만들기] 에서 노래 없이 바로 시작하면 예시 노래와 가짜 그림으로 전체 흐름을 2~3분 만에 볼 수 있어요. (무료) 내 노래를 올려서 체험하면 컷·자막은 실제처럼 만들어져요.'),
          h('li', null, h('b', null, '구독 연결: '), '[AI 연결 설정] 에서 가진 구독 카드의 [설치하기] → [로그인 하기] → [연결 테스트] 를 차례로 눌러요.'),
          h('li', null, h('b', null, '빠른 설정: '), '같은 화면 위쪽의 "빠른 설정" 에서 내 구독 조합을 고르면 단계별 담당 AI 가 자동으로 정해져요.'),
          h('li', null, h('b', null, '(선택) 워크플로우: '), '[워크플로우] 에서 기본 틀을 복사해 그림체·노래 장르·컷 수·자막 모양을 내 취향대로 저장해요.'))),

      h('div', { class: 'section' },
        h('h3', null, '영상 하나가 만들어지는 과정'),
        h('ol', null,
          h('li', null, h('b', null, '노래·가사: '), 'Suno 등에서 만든 노래 파일과 가사를 올리면, 내 PC 가 길이·BPM·박자·마디를 분석해요. (영상 길이 = 노래 길이, 보통 3~4분)'),
          h('li', null, h('b', null, '기획: '), '구독 중인 LLM 이 가사와 노래 구조(벌스·후렴 등)를 보고 스토리보드, 시나리오, 등장인물을 써요.'),
          h('li', null, h('b', null, '타이밍 설계: '), '가사 자막 시간을 맞추고(탭으로 맞추기 또는 자동), 컷 10~15개를 ', h('b', null, '박자 위에서만'), ' 자르고(1~30초), 컷마다 장면과 화면전환(컷/페이드/플래시 등)을 정해요.'),
          h('li', null, h('b', null, '키프레임: '), '먼저 캐릭터 기준 그림을 만든 뒤, 컷마다 첫 장면 그림을 "문장 구조 틀" 로 만든 프롬프트로 그려요.'),
          h('li', null, h('b', null, '영상 클립: '), '키프레임을 컷 길이에 맞춰 영상으로 움직여요. 영상 AI 는 한 번에 15초까지라서, 더 긴 컷은 마지막 장면에서 이어 만들어 붙여요.'),
          h('li', null, h('b', null, '최종 편집: '), '클립을 박자에 맞춰 화면전환으로 잇고, 하단에 가사 자막을 띄우고, 노래를 깔아요. (내 PC 에서 처리, 무료)'))),

      h('div', { class: 'section' },
        h('h3', null, '구독별로 할 수 있는 것'),
        h('table', { class: 'prov-table' }, h('tbody', null,
          h('tr', null, h('td', null, 'ChatGPT (Plus/Pro)'), h('td', null, 'Codex CLI 로 기획 글쓰기 + 키프레임 이미지(gpt-image) 자동. 영상·음악은 도우미/자동 클릭.')),
          h('tr', null, h('td', null, 'SuperGrok / X Premium+'), h('td', null, 'grok CLI 로 기획 + 이미지 + 이미지→영상 자동. 음악은 도우미/자동 클릭.')),
          h('tr', null, h('td', null, 'Google AI Pro / Ultra'), h('td', null, 'Antigravity CLI(agy) 로 기획 자동. Gemini 웹의 이미지(나노바나나)·영상(Veo)은 도우미/자동 클릭.')),
          h('tr', null, h('td', null, 'Claude Pro / Max'), h('td', null, 'Claude Code 로 기획 자동.'))))),

      h('div', { class: 'section' },
        h('h3', null, '도우미 모드 쓰는 법 (웹에서만 되는 단계)'),
        h('ol', null,
          h('li', null, '진행 화면에 노란색 "🙋 도와주세요" 카드가 뜨면'),
          h('li', null, '[📋 복사] 를 눌러 프롬프트(또는 스타일+가사)를 복사하고, 필요하면 [🖼️ 이미지 복사] 도 눌러요.'),
          h('li', null, '[🌐 사이트 열기] → 입력창에 Ctrl+V 로 붙여넣고 만들기 → 결과를 ', h('b', null, '다운로드'), '해요.'),
          h('li', null, '다운로드 폴더에 새 파일이 생기면 앱이 ', h('b', null, '자동으로 가져가서'), ' 다음 단계로 넘어가요. (안 되면 파일을 카드에 끌어다 놓기)'))),

      h('div', { class: 'section' },
        h('h3', null, '자주 묻는 질문'),
        h('p', null, h('b', null, 'Q. 돈이 더 나가나요? '), '아니요. API 키를 쓰지 않고 구독 계정 로그인만 써요. 대신 구독마다 사용 한도가 있어서, 한도에 걸리면 설정한 시간만큼 기다렸다가 자동으로 이어서 해요.'),
        h('p', null, h('b', null, 'Q. 가사 자막 타이밍이 안 맞아요. '), '[노래·가사·타이밍] 탭의 [⌨ 탭으로 가사 맞추기] 를 눌러 노래를 들으며 줄이 시작될 때 스페이스바를 누르세요. 저장 후 "자막만 다시 입히기" 를 고르면 몇십 초 만에 다시 만들어져요.'),
        h('p', null, h('b', null, 'Q. 가사 자막을 처음부터 정확히 맞추고 싶어요. '), '시간이 들어 있는 가사 파일(.lrc 또는 .srt)을 가사 칸에 불러오면 그 시간을 그대로 써요. 없으면 가사를 붙여넣고, 진행 중에 나오는 [⌨ 탭으로 가사 맞추기] 를 한 번 하면 돼요. (노래 길이만큼 걸려요)'),
        h('p', null, h('b', null, 'Q. 박자가 이상하게 잡혀요. '), '같은 탭에서 BPM 숫자를 고치고 [BPM 바꿔서 다시 분석] 을 누르세요. (빠른 곡이 절반으로, 느린 곡이 두 배로 잡히는 경우가 있어요)'),
        h('p', null, h('b', null, 'Q. 그림 하나만 다시 만들고 싶어요. '), '[키프레임] 탭에서 그 그림의 [✏️ 다시] 를 누르세요. 그다음 [영상 클립] 에서 같은 컷을 다시 만들고, [완성 영상] 에서 [다시 만들기] 를 누르면 반영돼요.'),
        h('p', null, h('b', null, 'Q. 오류가 났어요. '), '대부분 로그인 만료나 한도 문제예요. [AI 연결 설정] 에서 [연결 테스트] 를 해 보고, 진행 화면에서 [▶ 이어서 하기] 를 누르세요. 만든 부분은 저장되어 있어요. 자세한 내용은 [📜 진행 기록] 탭에 있어요.'),
        h('p', null, h('b', null, 'Q. 파일은 어디에 있나요? '), `문서 폴더의 AnimeMaker 안에 작업마다 폴더가 생겨요. 완성 영상은 output 폴더, 가사 자막 파일(srt/lrc)과 스토리보드도 같이 있어요.`)),

      h('div', { class: 'section' },
        h('h3', null, '꼭 알아 두세요'),
        h('ul', null,
          h('li', null, h('b', null, '저작권·초상권: '), '실존 인물, 유명 캐릭터, 기존 노래 가사를 주제로 쓰지 마세요. 기획 단계에서도 "오리지널만" 쓰도록 지시하고 있어요.'),
          h('li', null, h('b', null, 'AI 생성 표시: '), '유튜브·틱톡 등은 사실적인 AI 생성 콘텐츠에 표시를 요구해요. 업로드할 때 해당 옵션을 켜세요. 완성 파일 정보에도 "AI 생성" 표시를 넣어 두었어요.'),
          h('li', null, h('b', null, '서비스 약관: '), '각 AI 의 이용약관과 생성물 이용 조건(상업적 이용 가능 여부 등)을 확인하세요. 자동 클릭은 약관 위반 소지가 있어 기본으로 꺼져 있어요.'),
          h('li', null, h('b', null, '도움말 링크: '), link('Codex CLI', 'https://developers.openai.com/codex'), ' · ', link('Grok Build', 'https://docs.x.ai/build/overview'), ' · ', link('Antigravity CLI', 'https://antigravity.google/docs/cli/headless/'), ' · ', link('Suno', 'https://suno.com')))));
  };
}(window.AM));
