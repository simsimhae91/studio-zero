---
name: public-data
does: Fetches what Korea's public bodies publish through the public data portal (data.go.kr), such as each hospital's published non-covered prices, on the product's server.
check: one call to HIRA's non-covered price service (getNonPaymentItemCodeList2, one row), which the owner must have applied for; free, one of the day's calls
keys:
  - id: data/data-go-kr/service-key
    env: DATA_GO_KR_SERVICE_KEY
    what: the service key (일반 인증키) of the owner's data.go.kr account, one key for every API the account applies for
    without: stops
    costs: free; each API is applied for on its own page (HIRA's non-covered prices are approved automatically), and calls are limited a day (10,000 for HIRA's on a development account)
---

# public-data: Korea's public data portal

Read on 2026-11-17. **[page]** https://www.data.go.kr/data/15001700/openapi.do (its operations and error table); **[guide]** the guide attached there, `OpenAPI활용가이드_건강보험심사평가원(비급여진료비정보서비스)_200515.docx`, version 3.0 of 2019-09-27; **[FAQ n]** entry `FAQ_0000000000000n` of https://www.data.go.kr/bbs/faq/selectFaqList.do.

## When a product takes it

When it shows a figure a public body publishes (a price, a place, opening hours) and a person acts on it. Without the key a builder has only made-up figures, and nothing is built on those. Not for a dataset the portal offers as a file (`fileData.do`): that needs no key; take the file and show its date.

## The key

- One key per account: every API the account applies for is called with it, and issuing it again changes it for all of them [FAQ 209].
- Each API is applied for (활용신청) on its own page; approval is automatic or by the provider's review, as the page's 심의유형 says [FAQ 264]. A new key can be refused (code 30) for about an hour [FAQ 172].
- Calls are counted per key per day and start again at midnight [FAQ 208].
- The key holds characters such as `=` that an address must carry URL-encoded [FAQ 172, 207]. The portal shows it in an encoded and a decoded form (their labels are behind a sign-in and were not seen); the vault may hold either. The server decodes once when the value holds `%` and lets `URLSearchParams` encode once: encoded twice, or not at all, it is refused with code 30.
- The gateway's errors [page; FAQ 214]: 20 not applied for, or not approved or paused; 22 the day's calls used; 30 key unknown for this API (wrong, or the application not complete); 31 period of use ended. The XML they come in was not seen (that needs a key): read `returnAuthMsg` and `returnReasonCode`, else `resultCode`/`resultMsg`.

## On the server

The key is `env.DATA_GO_KR_SERVICE_KEY` on a Worker and `Deno.env.get('DATA_GO_KR_SERVICE_KEY')` in a Supabase edge function. The address carries the key: it is never logged, returned or made in a browser.

```ts
const HIRA = 'https://apis.data.go.kr/B551182/nonPaymentDamtInfoService';
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export async function hira(op: string, params: Record<string, string>, raw: string): Promise<Record<string, string>[]> {
  const ServiceKey = raw.includes('%') ? decodeURIComponent(raw) : raw;
  const xml = await (await fetch(`${HIRA}/${op}?${new URLSearchParams({ ServiceKey, ...params })}`)).text();
  if (/<resultCode>([^<]*)</.exec(xml)?.[1] !== '00') throw new Error(/<returnAuthMsg>([^<]*)</.exec(xml)?.[1] ?? /<resultMsg>([^<]*)</i.exec(xml)?.[1] ?? 'no answer');
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => Object.fromEntries([...item!.matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(([, k, v]) => [k!, unxml(v!)])));
}
```

Answers are XML only [guide] (whether `_type=json` works was not checked). Rows come in pages (`pageNo`, `numOfRows`, `totalCount`); the data changes once a month [guide], so a product keeps what it fetched (D1, Postgres) rather than calling for each visitor.

- While developing, Worker: `CLOUDFLARE_INCLUDE_PROCESS_ENV=true sz-eyes secret run DATA_GO_KR_SERVICE_KEY=data/data-go-kr/service-key -- npx wrangler dev ...`, with no `.dev.vars` file (wrangler reads the shell's environment only then: developers.cloudflare.com/workers/development-testing/environment-variables/).
- While developing, Supabase: `DATA_GO_KR_SERVICE_KEY = "env(DATA_GO_KR_SERVICE_KEY)"` under `[edge_runtime.secrets]` in `supabase/config.toml`, started as `sz-eyes secret run DATA_GO_KR_SERVICE_KEY=data/data-go-kr/service-key -- sz-eyes supabase start ...` (supabase.com/docs/guides/functions/secrets; not yet run here).
- Shipped: the host's secrets (`npx wrangler secret put DATA_GO_KR_SERVICE_KEY`, `supabase secrets set`), set at the release (`sz:ship`).

## What users are told

Each figure says where it is from and of when: 건강보험심사평가원 비급여 진료비 공개 자료, with the row's `adtFrDd`. The licence is 공공누리 제1유형, which asks for the source to be named [page]. A published price is what an institution reported, not what a person will be charged.

## Shown to be real

One institution and one item chosen before the build: the figure on the product's screen equals the row the API returned for them (kept as evidence, read by the product's server under `sz-eyes secret run`), with its source and date beside it. A figure no call returned fails it.

## APIs read so far

### 건강보험심사평가원_비급여진료비정보조회서비스 (HIRA: non-covered prices)

[page]: free, automatic approval for development and production, 10,000 calls a day on a development account (more when a use case is registered), registered 2019-08-29, changed 2026-01-14. `https://apis.data.go.kr/B551182/nonPaymentDamtInfoService/<operation>`, REST GET, XML; at most 30 calls a second [guide]. Every operation takes `ServiceKey`, `pageNo`, `numOfRows`. Since March 2016 [page]:

| Operation | Gives | Also takes | Fields |
|---|---|---|---|
| `getNonPaymentItemCodeList2` | the item codes | nothing | `npayCd`, `npayKorNm`, classes (`npayMdivCd`/`Nm`, `npaySdivCd`/`Nm`, `npayDtlDivCd`/`Nm`), `cmmtTxt` note, `adtFrDd`, `adtEndDd` |
| `getNonPaymentItemHospList2` | each institution's price range for one item | `itemCd` (required, like `ABZ010001`), `clCd` kind, `sidoCd`, `sgguCd`, `yadmNm` name, `searchWrd` item words | `ykiho` (the institution, encrypted), `yadmNm`, `clCd`/`Nm`, `sidoCd`/`Nm`, `sgguCd`/`Nm`, `urlAddr`, `npayCd`, `npayKorNm`, classes, `adtFrDd`, `adtEndDd`, `minPrc` lowest, `maxPrc` highest |
| `getNonPaymentItemHospDtlList` | one institution's prices, item by item | `ykiho` (required), `clCd`, `sidoCd`, `sgguCd`, `yadmNm` | `ykiho`, `yadmNm`, kind and region, `urlAddr`, `sno`, `npayCd`, `npayKorNm`, `yadmNpayCdNm` (its own name for the item), `adtFrDd`, `adtEndDd`, `curAmt` |
| `getNonPaymentItemClcdList` | each item's highest, lowest, mean and median by kind of institution | nothing | `npayCd`, `npayKorNm`, `stdDate`, `prcMax…`, `prcMin…`, `prcAvg…`, `middAvg…` per kind |
| `getNonPaymentItemSidoCdList` | the same by province | nothing | the same per province (`…Sl` Seoul to `…Sejong`) |

`getNonPaymentItemCodeList` and `getNonPaymentItemHospList` hold what was before March 2016.

Not in it, or not confirmed:
- `clCd` takes 01 상급종합, 11 종합병원, 41 치과병원 [guide]. A dental clinic (치과의원) is not among them. **Whether the data holds clinics (의원) today was not confirmed** (that needs a key): before a product compares a clinic's estimate with it, ask `getNonPaymentItemHospList2` with a dental item and that clinic's name, with the owner's key.
- Which dental items have codes was not seen (the code list needs a key).
- `ykiho` comes from these answers; HIRA's 병원정보서비스 (`getHospBasisList1`, applied for apart) lists institutions with theirs (https://www.data.go.kr/data/15094093/openapi.do).

## 주인이 할 일

### 공공데이터포털 인증키 (`data/data-go-kr/service-key`)

1. www.data.go.kr 에 회원가입하고 로그인합니다.
2. https://www.data.go.kr/data/15001700/openapi.do (건강보험심사평가원_비급여진료비정보조회서비스)를 열고 [활용신청]을 누릅니다. 활용 목적을 적고 신청합니다. 이 API는 자동승인입니다.
3. 마이페이지 > 데이터 활용 > Open API > 활용신청 현황에서 승인된 것을 확인합니다.
4. 마이페이지에서 일반 인증키를 복사합니다. 인코딩된 것과 디코딩된 것 중 어느 쪽이어도 됩니다.
5. 이 세션의 입력창에 이 한 줄을 그대로 실행합니다: `! pbpaste | sz-eyes secret set data/data-go-kr/service-key`
6. 키를 처음 받았다면 한 시간쯤 뒤에 `sz-eyes arm check public-data` 로 확인합니다. 발급 직후에는 등록되지 않은 키라고 나올 수 있습니다.

다른 공공데이터 API가 필요하면 같은 키로 그 API 페이지에서 [활용신청]만 하면 됩니다. 키를 다시 발급받으면 모든 API의 키가 바뀌므로 5번 줄을 다시 실행합니다.
