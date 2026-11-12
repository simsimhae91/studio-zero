import type { ApprovalState, LessonState, Phase, ProposalState, Severity, TaskKind, TaskState, Template, ViewportId } from '@studio-zero/protocol';

export const taskStateLabel: Record<TaskState, string> = {
  queued: '대기 중',
  running: '진행 중',
  awaiting_approval: '승인 대기',
  succeeded: '완료',
  failed: '실패',
  cancelled: '취소됨',
};

export const phaseLabel: Record<Phase, string> = { plan: '계획', execute: '구현', verify: '검증', reflect: '회고', evolve: '반영' };

export const kindLabel: Record<TaskKind, string> = { build: '만들기', refactor: '리팩터링', inline_edit: '빠른 수정', ideate: '기획', kirby_materialize: '제안 구현' };

/** Engines by the name of what the owner pays for. */
export const engineLabel: Record<string, string> = { 'native-claude': 'Claude API', 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor', antigravity: 'Antigravity' };

export const templateLabel: Record<Template, string> = { 'web-vite-react': '웹 (Vite + React)', 'web-next': '웹 (Next.js)', 'mobile-expo': '모바일 (Expo)' };

export const viewportLabel: Record<ViewportId, string> = { 'iphone-15-pro': '폰', 'ipad-pro-11': '태블릿', 'desktop-1440': '데스크톱' };

export const severityLabel: Record<Severity, string> = { blocker: '블로커', major: '주요', minor: '사소' };

export const lessonStateLabel: Record<LessonState, string> = { candidate: '후보', active: '적용 중', quarantined: '격리됨', retired: '폐기' };

export const proposalStateLabel: Record<ProposalState, string> = { proposed: '제안됨', materializing: '구현 중', ready: '검토 가능', merged: '병합됨', rejected: '거절됨', failed: '구현 실패' };

export const approvalStateLabel: Record<ApprovalState, string> = { pending: '대기', approved: '승인됨', denied: '거절됨', expired: '만료됨', consumed: '승인됨' };

const evalNames: Record<string, string> = { 'slop-lint': '슬롭 린트', 'visual-audit': '시각 감사', typecheck: '타입 검사', 'ideation-documents': '기획 문서' };
export const evalLabel = (name: string): string => evalNames[name] ?? name;

const relative = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });

/** "3분 전", "어제" — coarse on purpose; exact times are in the title attribute where they matter. */
export function ago(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return '방금';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

/** When something on a page happened: the time for today, the date for anything older. */
export function stamp(at: number, now = Date.now()): string {
  const when = new Date(at);
  return when.toDateString() === new Date(now).toDateString() ? when.toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit', hour12: false }) : when.toLocaleDateString('ko', { month: 'long', day: 'numeric' });
}

export const clock = (at: number): string => new Date(at).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.floor(ms / 60_000)}분 ${Math.round((ms % 60_000) / 1000)}초`;
}

/** A name for something from the first line of what was written about it: short, and cut between words. */
export function nameFrom(text: string, max = 28): string {
  const line = text.split('\n')[0]!.trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.:;]+$/, '')}…`;
}

/** A URL-safe slug from a project name. Hangul has no ASCII form, so a name without Latin letters gets a neutral one. */
export function slugify(name: string): string {
  const ascii = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(ascii) ? ascii : `project-${Math.random().toString(36).slice(2, 8)}`;
}

const ruleTitles: Record<string, string> = {
  'contrast/text': '글자 대비 부족',
  'render/blank': '화면이 비어 있음',
  'render/load-failed': '화면을 불러오지 못함',
  'responsive/missing-viewport-meta': 'viewport 메타 태그 없음',
  'responsive/horizontal-overflow': '가로로 넘침',
  'responsive/clipped-text': '글자가 잘림',
  'touch/target-size': '터치 영역이 작음',
  'type/off-scale': '글자 크기가 스케일 밖',
  'type/too-many-sizes': '글자 크기 종류가 많음',
  'type/small-body': '본문 글자가 작음',
  'type/line-height': '줄 높이',
  'type/line-length': '한 줄이 너무 김',
  'type/foreign-font': '테마에 없는 서체',
  'type/font-not-loaded': '서체가 로드되지 않음',
  'spacing/off-grid': '간격이 4px 리듬에서 벗어남',
  'shape/off-scale-radius': '모서리 반경이 테마 밖',
  'shape/too-many-radii': '모서리 반경 종류가 많음',
  'slop/cliche-gradient': '파랑-보라 그라디언트',
  'slop/caps-eyebrow': '자간 넓힌 대문자 라벨',
  'slop/emoji-as-icon': '아이콘 자리의 이모지',
  'slop/identical-cards': '똑같은 카드의 반복',
  'vision/hierarchy': '위계',
  'vision/spacing': '여백',
  'vision/typography': '타이포그래피',
  'vision/color': '색',
  'vision/copy': '문구',
  'vision/originality': '독창성',
  'vision/responsive': '반응형',
  'vision/contrast': '대비',
};
/** A short name for an audit rule, in the interface's language. The measured detail stays as the daemon wrote it. */
export const ruleTitle = (rule: string): string => ruleTitles[rule.replace(/@dark$/, '')] ?? rule;

const metricLabels: Record<string, string> = {
  'source files': '소스 파일 수',
  'lines of code': '코드 줄 수',
  '`any` annotations': 'any 타입 표기',
  'type/lint suppressions': '타입·린트 억제 주석',
  'import cycles': '순환 import',
  'test files': '테스트 파일 수',
  'mean file complexity': '파일당 평균 복잡도',
  'slop-lint major findings': '슬롭 린트 주요 발견',
};
/** Kirby's measured metrics, named for the reader. A practice metric is 0 (absent) or 1 (adopted). */
export function metricLabel(metric: string): string {
  const practice = /^practice: (.+)$/.exec(metric);
  return practice ? `관행 채택 (${practice[1]})` : (metricLabels[metric] ?? metric);
}
