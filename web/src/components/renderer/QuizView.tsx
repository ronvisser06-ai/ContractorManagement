import type { ContentModel, Quiz } from '@/contracts/types'

interface Props {
  quiz: Quiz
  contentModel: ContentModel
}

// Renders source_refs as the actual cited block's text (not just the opaque
// id) — the audit trail contracts §4.4 describes is only useful to a human
// reviewer if they can see what's actually being cited.
function citedBlockSnippet(contentModel: ContentModel, blockId: string): string {
  for (const courseModule of contentModel.modules) {
    for (const block of courseModule.blocks) {
      if (block.id !== blockId) continue
      const text = block.text ?? block.hazard ?? block.title
      return typeof text === 'string' ? text : blockId
    }
  }
  return blockId
}

// Quiz review for the approval gate (contracts §4.4) — not part of the closed
// renderer (that's the content model's job), just a plain review list.
export function QuizView({ quiz, contentModel }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pass threshold {Math.round(quiz.meta.pass_threshold * 100)}% · {quiz.meta.attempts_allowed} attempts allowed ·{' '}
        {quiz.meta.question_count} question{quiz.meta.question_count === 1 ? '' : 's'}
      </p>
      {quiz.questions.map((question, i) => (
        <div key={question.id} className="space-y-2 rounded-md border bg-card p-4">
          <p className="font-medium">
            {i + 1}. {question.stem}
          </p>
          <ul className="space-y-1 pl-4 text-sm">
            {question.options.map((option) => {
              const isCorrect = question.correct_option_ids.includes(option.id)
              return (
                <li key={option.id} className={isCorrect ? 'font-medium text-primary' : ''}>
                  {isCorrect ? '✓ ' : '— '}
                  {option.text}
                </li>
              )
            })}
          </ul>
          <p className="text-sm text-muted-foreground">{question.rationale}</p>
          <p className="text-xs text-muted-foreground">
            Cites:{' '}
            {question.source_refs.map((blockId, idx) => (
              <span key={blockId}>
                {idx > 0 && ', '}
                &quot;{citedBlockSnippet(contentModel, blockId)}&quot;
              </span>
            ))}
          </p>
        </div>
      ))}
    </div>
  )
}
