import type { AxBlock, AxResponse } from '@studio-zero/protocol';

/** A block as the model reads it back in later turns: enough to know what the owner was shown. */
export function describeBlock(block: AxBlock): string {
  switch (block.type) {
    case 'text':
      return block.markdown;
    case 'choice':
      return `[asked the owner, id ${block.id}] ${block.question}\n${block.options.map((o) => `- (${o.id}) ${o.label}${o.detail ? `: ${o.detail}` : ''}`).join('\n')}${block.recommended ? `\nrecommended: ${block.recommended} (${block.confidence})` : ''}`;
    case 'comparison':
      return `[comparison] ${block.title}\ncriteria: ${block.criteria.join(' | ')}\n${block.options.map((o) => `- ${o.label}: ${o.cells.join(' | ')}`).join('\n')}${block.recommended ? `\nrecommended: ${block.recommended} (${block.confidence})` : ''}`;
    case 'form':
      return `[asked the owner to set values, id ${block.id}] ${block.title}: ${block.fields.map((f) => f.label).join(', ')}`;
    case 'diagram':
      return `[diagram] ${block.title}\n${block.mermaid}`;
    case 'decision':
      return `[decision recorded] ${block.question} → ${block.chosen} (${block.confidence})`;
    case 'sources':
      return `[sources] ${block.title}\n${block.items.map((s, i) => `${i + 1}. ${s.title} ${s.url}`).join('\n')}`;
    case 'checklist':
      return `[checklist] ${block.title}\n${block.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.label}`).join('\n')}`;
  }
}

/** The owner's answer to a block, as a sentence for the model. */
export function describeResponse(response: AxResponse, block: AxBlock | undefined): string {
  if (response.kind === 'choice') {
    const option = block?.type === 'choice' ? block.options.find((o) => o.id === response.optionId) : undefined;
    const question = block?.type === 'choice' ? block.question : response.blockId;
    return `The owner answered "${question}": ${option ? option.label : (response.other ?? '(no answer)')}${option && response.other ? ` — and added: ${response.other}` : ''}`;
  }
  const title = block?.type === 'form' ? block.title : response.blockId;
  return `The owner set "${title}": ${Object.entries(response.values).map(([k, v]) => `${k} = ${String(v)}`).join(', ')}`;
}
