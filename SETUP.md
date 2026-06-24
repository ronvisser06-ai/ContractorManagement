# Vibe Coding Planner Setup Guide

You've created a complete coaching system for disciplined vibe coding. Here's everything that's in place.

---

## What We've Built

### 1. **CLAUDE.md** ⭐ MAIN FILE
Your project configuration that tells me:
- **Tech Stack**: Next.js, TypeScript, Tailwind, Supabase, Flutter
- **Architecture**: Jacques coaching system (skill + passive monitor)
- **Directory Structure**: Web/mobile/docs organization
- **Code Standards**: TypeScript strict, mobile-first, no overengineering
- **Testing**: Unit tests per feature, integration testing
- **The 20 Rules**: All embedded as your development law

**What to do**: Keep CLAUDE.md in your root directory. Add to it whenever you discover I need clarification.

### 2. **JACQUES.md** — Coaching Guide
Detailed explanation of how Jacques works:
- Invoking Jacques with specific requests (`jacques start feature`, `jacques i'm stuck`)
- Jacques's operating principles
- The rules Jacques enforces (with priority)
- Favorite phrases Jacques uses

**What to do**: Reference this before each session.

### 3. **BUILDLOG.md** — Session Tracking
Template for recording every development session:
1. What you built
2. What broke (and how you fixed it)
3. What's next

**What to do**: Update after every feature completion. Helps continuity between sessions.

### 4. **Memory Files** (Persistent)
In your memory system:
- `jacques_vibe_coding_rules.md` — All 20 rules with full explanations
- `jacques_coaching_approach.md` — How Jacques operates

**What to do**: I'll reference these automatically in future conversations.

---

## How to Use This System

### Starting a New Session

Say one of:
```
"Jacques, let's start a new feature"
"Jacques, I have a project idea"
"Jacques, let's build [feature name]"
```

Jacques will:
1. Ask your three planning questions (What? Who? Done?)
2. Confirm one feature scope
3. Verify your tech stack matches CLAUDE.md
4. Guide you through planning before Act Mode

### During Development

Jacques will:
- **Passively monitor** for rule violations (especially Rules 1, 2, 6, 20)
- **Interrupt** if you break a critical rule with specific guidance
- **Remind you** to test after changes, commit to git, keep context fresh

### Invoking Jacques Explicitly

```
jacques check progress        # Audit what you're doing
jacques i'm stuck             # Help change angles
jacques how's the design      # Check mobile/spacing/typography
jacques ship check            # Ready to go live?
jacques what's next           # Plan the next feature
```

### When Stuck

Jacques will help with Rule 10 strategies:
1. /clear conversation and restart fresh
2. Simplify the task (break into smaller pieces)
3. Show Jacques a working example
4. Reframe the problem differently

---

## The 20 Rules at a Glance

**Planning (Rules 1-5)**:
- Think before you prompt (3 questions)
- Plan Mode first, always
- Describe outcomes, not code
- Show visual references
- Decide tech stack upfront

**Building (Rules 6-12)**:
- ONE FEATURE AT A TIME (non-negotiable)
- Test after every change
- Use screenshots for visual feedback
- Commit to git after working features
- Change angle when stuck
- /compact when conversations get long
- Tell me what NOT to do (constraints)

**Design (Rules 13-16)**:
- Steal designs shamelessly (reference existing work)
- Mobile first, always
- Typography and spacing > colors
- Add polish last

**System (Rules 17-20)**:
- Create CLAUDE.md day one (✓ Done)
- Fresh conversation per feature
- Keep a build log (BUILDLOG.md)
- Ship before perfect (non-negotiable)

---

## File Checklist

- ✅ **CLAUDE.md** — Main configuration (in root)
- ✅ **JACQUES.md** — Coaching guide (in root)
- ✅ **BUILDLOG.md** — Session tracking (in root)
- ✅ **SETUP.md** — This file (in root)
- ✅ **Memory Files** — jacques_vibe_coding_rules.md, jacques_coaching_approach.md (in memory system)
- ⏳ **.claude/rules/jacques-enforcement.md** — Enforcement rules (you'll need to create in .claude folder)

---

## Next Steps

### Immediate (Do Today)

1. **Read JACQUES.md** — Understand how Jacques works
2. **Review CLAUDE.md** — Know your tech stack and rules
3. **Create your first feature** — Say "Jacques, I want to build [project]"

### Ongoing (Every Session)

1. **Start with Planning** — Answer the 3 questions
2. **Build one feature** — Use Plan Mode first
3. **Test after changes** — Open browser, click around
4. **Commit to git** — Save progress
5. **Update BUILDLOG.md** — Track what happened

### As You Go

- Add constraints to CLAUDE.md when I violate them twice
- Keep Jacques.md with you for reference
- Let Jacques interrupt when rules are broken (this is the coaching in action)

---

## Remember

**The 20 rules exist because:**
- Rules 1-5 prevent building the wrong thing
- Rules 6-12 prevent shipping broken things
- Rules 13-16 prevent shipping ugly things
- Rules 17-20 prevent endless iteration

**Your job**: Follow the process. Jacques enforces it.

**The process works**: People who follow these rules ship real products in 48 hours. People who skip them iterate endlessly.

---

## Ready?

When you're ready to build your first feature:

**Say**: "Jacques, I have a project idea: [describe it]"

**Jacques will**:
1. Ask your 3 planning questions
2. Make sure you're thinking clearly
3. Map the architecture
4. Guide you through one feature at a time
5. Keep you from breaking the rules

Let's ship something.

---

**Last Updated**: 2026-05-29
**System**: Vibe Coding Planner + Jacques Coaching
**Status**: Ready to build
