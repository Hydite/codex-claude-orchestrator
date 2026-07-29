# Codex × Claude Orchestrator

Codex 메인 스레드, 네이티브 Codex subagent, Claude CLI를 회귀 게이트, 격리 worktree, 안전한 인계를 갖춘 병렬 개발 팀으로 구성합니다. Codex는 지휘자이자 개발자이며 능력, 위험, 의존성, 파일 경계를 기준으로 역할을 동적으로 배정합니다.

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [릴리스](https://github.com/Hydite/codex-claude-orchestrator/releases)

## 목차

- [개요](#개요)
- [최신 컨트롤 플레인](#최신-컨트롤-플레인)
- [주요 기능](#주요-기능)
- [설치](#설치)
- [일반적인 흐름](#일반적인-흐름)
- [Gateway](#gateway)
- [개발 및 문서](#개발-및-문서)
- [라이선스](#라이선스)

## 개요

모든 노드를 하나의 작업 그래프에서 관리합니다. 각 노드는 독립 worktree, 파일 예약, 제약, 체크포인트, 회귀 게이트를 가집니다. Claude는 전용 worktree에서 백그라운드로 실행되고 Codex는 자신의 노드를 병렬로 진행합니다.

## 최신 컨트롤 플레인

React MCP App은 Codex 오른쪽 미리보기 영역에서 열립니다. 현재 작업은 `Board / List`에서 바로 시작하며, 가짜 `Agent / Editor` 애플리케이션 바는 제거되었습니다.

![전체 Board](./docs/images/dashboard-board.jpg)

### 뷰와 상태

![List 뷰](./docs/images/dashboard-list.jpg)

![Running 상태](./docs/images/dashboard-running.jpg)

![Blocked 상태](./docs/images/dashboard-blocked.jpg)

![Ready 상태](./docs/images/dashboard-ready.jpg)

## 주요 기능

- 개발 전에 공유, Codex, Claude, 계약 정렬 제약을 수집하고 명시적으로 건너뛸 수 있습니다.
- 배정 이유, 능력 근거, 실행 모드, 의존성, 구조화 입력, 파일 범위를 포함한 동적 역할 분담.
- Claude, Codex, 네이티브 subagent가 서로 다른 경계에서 실제로 병렬 실행.
- 체크포인트, 다음 작업, Blocked/Review 큐, 설정 가능한 회귀 명령.
- 경계 위반, 능력 부족, 검증 실패, 계약 변경, 보안 승격, 런타임 오류, 시간 초과, 부하 분산을 위한 안전한 handoff.
- 격리 worktree, 실행 전 예약, 실행 후 중복 검사, 독립 검증, 명시적 merge gate.

## 설치

Node.js 20 이상, Git, 인증된 Claude CLI, 로컬 MCP 플러그인을 지원하는 Codex 클라이언트가 필요합니다.

```bash
npm run install:personal       # 개인 마켓플레이스
npm run install:marketplace    # Hydite Git 마켓플레이스
```

OpenAI 마켓플레이스 제출 패키지 생성:

```bash
npm run build:official
```

업데이트, 제거, 릴리스는 [`docs/INSTALLATION.md`](./docs/INSTALLATION.md)를 참고하세요. 설치 또는 업데이트 후 새 Codex 작업을 시작해야 최신 도구와 skill이 로드됩니다.

## 일반적인 흐름

1. `orchestrator_set_workspace`로 저장소를 연결합니다.
2. `claude_status`로 Claude CLI와 Gateway를 확인합니다.
3. 제약을 질문하고 `orchestrator_set_constraints`에 저장하거나 명시적으로 건너뜁니다.
4. 능력에 따라 Codex, subagent, Claude, 계약 정렬 노드를 만듭니다.
5. `orchestrator_dispatch_node`로 Claude를 실행하고 `orchestrator_start_codex_node`로 Codex를 병렬 실행합니다.
6. `orchestrator_checkpoint_node`와 `orchestrator_get_next_actions`로 팀 루프를 진행합니다.
7. 경계나 능력이 바뀌면 안전하게 인계하고 검증, 회귀, 리뷰, 병합을 수행합니다.

## Gateway

`claudeEnvironmentSource: "auto"`는 `~/.claude/settings.json`의 허용된 Gateway 변수를 읽습니다. `ANTHROPIC_BASE_URL`과 자격 증명이 있으면 탐지, 프로브, 서비스 시작, Claude 노드가 같은 Gateway를 사용합니다.

```json
{
  "claudeEnvironmentSource": "settings",
  "claudeSettingsPath": "~/.claude/settings.json"
}
```

Token은 메모리에서만 Claude 자식 프로세스로 전달되며 상태, 이벤트, 로그에 저장되지 않습니다.

## 개발 및 문서

```bash
npm install
npm run build:ui
npm run setup
npm run check
npm test
```

- [아키텍처](./docs/ARCHITECTURE.md)
- [개발 규칙](./docs/DEVELOPMENT.md)
- [보안](./docs/SECURITY.md)
- [설치 및 릴리스](./docs/INSTALLATION.md)
- [최신 릴리스](https://github.com/Hydite/codex-claude-orchestrator/releases/latest)

## 라이선스

MIT
