/**
 * What "검증까지" holds a build to, as the owner is told before starting one. Six things, each checked by the
 * daemon and none of them optional on that track: together they are why a verified build takes longer than a
 * draft. The wording is the client's; what is checked is the daemon's (see docs/ARCHITECTURE.md, §8.6).
 */
export const RIGOR_CHECKS: readonly { title: string; holds: string }[] = [
  { title: '고정표와 화면 명세', holds: '코드보다 먼저 커밋. 무엇을 중심으로 만드는지, 화면마다 무엇을 하는지, 핵심 흐름이 적힌 뒤에 시작' },
  { title: '디자인 심사', holds: '세 크기에서 계약 규칙으로 측정, 다른 구독의 리뷰어가 캡처를 심사. 85점 이상 · 슬롭 30 이하 · 블로커 0' },
  { title: '첫 화면의 실물', holds: '글과 선뿐인 첫 화면은 블로커. 명세가 적은 빈 화면 · 실패 화면도 열어서 캡처' },
  { title: '손맛', holds: '브라우저가 컨트롤을 직접 누르고 키보드 포커스를 옮겨 봄. 눌러도 그대로인 컨트롤, 안 보이는 포커스는 결함' },
  { title: '한국어 카피', holds: '화면의 글만 따로 읽음. 구호 제목 · 설명조 · 번역투 · 어디에나 붙는 버튼 문구 0건' },
  { title: '레퍼런스 견줌', holds: '레퍼런스를 붙인 작업만. 같은 도구로 양쪽을 재서 수준이 닿았는지, 베끼지 않았는지 확인' },
];
