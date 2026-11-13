import { RotateCw, Save, Shuffle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { OwnerSettings } from '@studio-zero/protocol';
import { tokens } from '../lib/format.ts';
import { useAction, useQuery, useStudio } from '../lib/studio.tsx';
import { Button, Field, Problem, Segmented, Status, inputClass } from '../ui.tsx';

const ON_OFF = [
  { id: 'on', label: '켬' },
  { id: 'off', label: '끔' },
] as const;

/** A topic name nobody could guess: on a public ntfy server the name is the only thing keeping a topic private. */
function topicName(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Ids as the owner types them, separated by commas or spaces. */
const ids = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean);

/**
 * The daemon's own settings, changed from the app: where it sends word, what a task and a day may spend, how
 * long an approval waits. They are written to the daemon's configuration file and take effect when it next
 * starts, so this says when a restart is owed and offers it.
 *
 * Only the app on the daemon's own Mac may change them; from another machine they are shown and locked. They
 * say who counts as the owner on other channels, and that was never something a token alone could do.
 */
export function DaemonSettings({ open }: { open: boolean }) {
  const { backend, link } = useStudio();
  const config = useQuery('config.get', open ? {} : null, ['config.changed']);
  const status = useQuery('system.status', open ? {} : null, ['task.state']);
  const [form, setForm] = useState<OwnerSettings | null>(null);
  const [telegram, setTelegram] = useState('');
  const [slack, setSlack] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const saved = config.data?.settings;
  // The form follows the file until the owner types; after that it is theirs until saved.
  useEffect(() => {
    if (!saved) return;
    setForm(saved);
    setTelegram(saved.telegram.allowedUserIds.join(', '));
    setSlack(saved.slack.allowedUserIds.join(', '));
  }, [saved]);

  const save = useAction(async (next: OwnerSettings) => {
    const result = await backend.call('config.set', { settings: next });
    setNote(result.restartRequired ? '저장했습니다. 데몬을 다시 시작하면 적용됩니다.' : '저장했습니다.');
    config.reload();
  });
  const restart = useAction(async () => {
    await backend.call('system.restart', {});
    setNote('데몬을 다시 시작하는 중입니다. 몇 초 뒤 다시 연결됩니다.');
  });
  // Back from a restart: what the file says is now what is running.
  useEffect(() => {
    if (link === 'connected') config.reload();
    // `reload` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  if (!form || !config.data) return config.error ? <Problem>{config.error}</Problem> : null;
  const locked = !config.data.writable;
  const set = <K extends keyof OwnerSettings>(section: K, patch: Partial<OwnerSettings[K]>): void => (setNote(null), setForm({ ...form, [section]: { ...form[section], ...patch } }));
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    setProblem(null);
    const telegramIds = ids(telegram).map(Number);
    if (telegramIds.some((id) => !Number.isInteger(id) || id <= 0)) return setProblem('Telegram 사용자 ID는 숫자입니다. 쉼표로 나눠 적어 주세요.');
    void save.run({ ...form, telegram: { ...form.telegram, allowedUserIds: telegramIds }, slack: { ...form.slack, allowedUserIds: ids(slack) } });
  };
  const busy = status.data ? status.data.queue.running + status.data.queue.queued : 0;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">알림과 한도</h3>
        <p className="text-base text-fg-muted">
          데몬의 설정 파일(<code className="break-all font-mono text-sm">{config.data.file}</code>)에 저장되고, 데몬을 다시 시작해야 적용됩니다. 봇 토큰 같은 비밀 값은 여기가 아니라 아래 자격 증명에 넣습니다.
        </p>
        {locked ? <Status tone="warn">다른 기기에서 연결했습니다. 여기서는 볼 수만 있고, 바꾸는 것은 데몬이 도는 Mac의 앱에서 합니다.</Status> : null}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-8">
        <fieldset disabled={locked} className="flex flex-col gap-4">
          <legend className="pb-2 text-base font-semibold">ntfy 알림</legend>
          <Segmented label="ntfy 알림" value={form.ntfy.enabled ? 'on' : 'off'} options={ON_OFF} disabled={locked} onChange={(v) => set('ntfy', { enabled: v === 'on' })} />
          <Field label="서버">
            <input className={inputClass} type="url" value={form.ntfy.server} onChange={(e) => set('ntfy', { server: e.target.value })} required />
          </Field>
          <Field label="알림 토픽" hint="폰의 ntfy 앱에서 이 이름을 구독합니다. 공개 서버에서는 이름이 곧 비밀번호입니다.">
            <input className={`${inputClass} font-mono`} value={form.ntfy.topic} onChange={(e) => set('ntfy', { topic: e.target.value.trim() })} maxLength={64} autoCapitalize="none" spellCheck={false} />
          </Field>
          <Field label="명령 토픽" hint="알림의 버튼이 답을 보내는 곳입니다. 알림 토픽과 달라야 하고, 폰에서 구독하지 않습니다.">
            <input className={`${inputClass} font-mono`} value={form.ntfy.commandTopic} onChange={(e) => set('ntfy', { commandTopic: e.target.value.trim() })} maxLength={64} autoCapitalize="none" spellCheck={false} />
          </Field>
          <Button className="self-start" onClick={() => set('ntfy', { topic: topicName('sz'), commandTopic: topicName('sz-cmd') })} icon={<Shuffle className="size-4" aria-hidden />}>
            토픽 이름 새로 만들기
          </Button>
        </fieldset>

        <fieldset disabled={locked} className="flex flex-col gap-4">
          <legend className="pb-2 text-base font-semibold">Telegram</legend>
          <Segmented label="Telegram" value={form.telegram.enabled ? 'on' : 'off'} options={ON_OFF} disabled={locked} onChange={(v) => set('telegram', { enabled: v === 'on' })} />
          <Field label="명령을 받을 사용자 ID" hint="숫자 ID를 쉼표로 나눠 적습니다. 여기 없는 사람의 말은 읽기 전에 버립니다.">
            <input className={`${inputClass} font-mono`} value={telegram} onChange={(e) => (setNote(null), setTelegram(e.target.value))} inputMode="numeric" />
          </Field>
        </fieldset>

        <fieldset disabled={locked} className="flex flex-col gap-4">
          <legend className="pb-2 text-base font-semibold">Slack</legend>
          <Segmented label="Slack" value={form.slack.enabled ? 'on' : 'off'} options={ON_OFF} disabled={locked} onChange={(v) => set('slack', { enabled: v === 'on' })} />
          <Field label="명령을 받을 멤버 ID" hint="U로 시작하는 멤버 ID를 쉼표로 나눠 적습니다. 봇과의 1:1 대화만 듣습니다.">
            <input className={`${inputClass} font-mono`} value={slack} onChange={(e) => (setNote(null), setSlack(e.target.value))} autoCapitalize="characters" spellCheck={false} />
          </Field>
        </fieldset>

        <fieldset disabled={locked} className="flex flex-col gap-4">
          <legend className="pb-2 text-base font-semibold">예산과 승인</legend>
          <Field label="작업 하나의 토큰 한도" hint={`지금 ${tokens(form.budgets.taskTokens)}. 넘으면 작업이 서고, 더 쓸지 승인을 묻습니다.`}>
            <input className={inputClass} type="number" min={100_000} step={100_000} value={form.budgets.taskTokens} onChange={(e) => set('budgets', { taskTokens: Number(e.target.value) })} required />
          </Field>
          <Field label="프로젝트 하나의 하루 토큰 한도" hint={`지금 ${tokens(form.budgets.projectDailyTokens)}. 스튜디오 자체의 계획·검수 호출도 여기서 나갑니다.`}>
            <input className={inputClass} type="number" min={100_000} step={100_000} value={form.budgets.projectDailyTokens} onChange={(e) => set('budgets', { projectDailyTokens: Number(e.target.value) })} required />
          </Field>
          <Field label="승인을 기다리는 시간 (분)" hint="이 시간 안에 답하지 않은 승인은 거절로 닫힙니다.">
            <input className={inputClass} type="number" min={1} max={1440} step={1} value={Math.round(form.approvals.ttlSec / 60)} onChange={(e) => set('approvals', { ttlSec: Math.max(30, Math.round(Number(e.target.value) * 60)) })} required />
          </Field>
        </fieldset>

        {(problem ?? save.error) ? <Problem>{problem ?? save.error}</Problem> : null}
        {note ? <Status tone="good">{note}</Status> : null}
        {locked ? null : (
          <Button type="submit" variant="primary" busy={save.busy} className="self-start" icon={<Save className="size-4" aria-hidden />}>
            설정 저장
          </Button>
        )}
      </form>

      {config.data.restartRequired ? (
        <div className="flex flex-col items-start gap-3 border-l-4 border-warning pl-4">
          <p className="text-base">저장한 설정이 아직 적용되지 않았습니다. 데몬은 시작할 때 읽은 값으로 돌고 있습니다.</p>
          {restart.error ? <Problem>{restart.error}</Problem> : null}
          {locked ? null : config.data.supervised ? (
            <>
              {busy > 0 ? <p className="text-base text-fg-muted">진행 중이거나 대기 중인 작업이 {busy}건 있습니다. 다시 시작하면 끊기므로, 끝난 뒤에 할 수 있습니다.</p> : null}
              <Button busy={restart.busy} disabled={busy > 0} onClick={() => void restart.run()} icon={<RotateCw className="size-4" aria-hidden />}>
                데몬 다시 시작
              </Button>
            </>
          ) : (
            <p className="text-base text-fg-muted">이 데몬은 터미널에서 직접 띄운 것이라 앱에서 다시 시작할 수 없습니다. 띄운 터미널에서 멈췄다가 다시 켜 주세요.</p>
          )}
        </div>
      ) : null}
      {config.data.logFile ? (
        <p className="text-sm text-fg-muted">
          데몬의 기록: <code className="break-all font-mono">{config.data.logFile}</code>
        </p>
      ) : null}
    </section>
  );
}
