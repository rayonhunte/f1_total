import { Link } from 'react-router-dom'

const featureGuides = [
  {
    title: '1. Live Race Lock Countdown',
    howTo: [
      'Open Picks and choose the race from the race timeline.',
      'Watch the lock countdown (minutes/seconds).',
      'Submit before zero; picks auto-lock at race lock time.',
    ],
  },
  {
    title: '2. Wildcard Chip (One Per Season)',
    howTo: [
      'In Picks, enable Wildcard for one race only.',
      'Wildcard applies your configured multiplier for that race score.',
      'After use, it is unavailable for the rest of the season.',
    ],
  },
  {
    title: '3. Budget Mode',
    howTo: [
      'If enabled by admin, build your lineup under the budget cap.',
      'Pick 3 drivers and (typically) 1 constructor based on league settings.',
      'If your cost exceeds the cap, save is blocked.',
    ],
  },
  {
    title: '4. Captain Pick',
    howTo: [
      'Choose a captain from your selected podium drivers.',
      'Captain points are multiplied by the league captain multiplier.',
      'Changing captain can significantly change weekly output.',
    ],
  },
  {
    title: '5. Safe Pick Hint Card',
    howTo: [
      'Use the Safe Pick card in Picks to view high-floor options from recent form.',
      'Review stable constructors and reliability context before locking.',
    ],
  },
  {
    title: '6. Groups and signing in',
    howTo: [
      'After sign-in you land on the Groups page. You are not auto-redirected to the app.',
      'If you own or belong to groups, use "Go to [group name]" to open that group in the app.',
      'You can join another group anytime: select a group from the dropdown and enter the invite code (even if you already own a group or are in another).',
      'Create a new group or request access to an existing one from the same page.',
    ],
  },
  {
    title: '7. Group messages',
    howTo: [
      'Open Messages from the app nav to see your group chat.',
      'Type in the composer to post. Use @ to mention other members; pick from the dropdown to tag them.',
      'Edit or delete your own messages via the controls on each message.',
    ],
  },
  {
    title: '8. Team themes',
    howTo: [
      'Use the theme dropdown in the header (next to the nav) to switch the app to a team colour theme.',
      'Your choice is saved and applied on future visits.',
    ],
  },
  {
    title: '9. Weekly Recap Card',
    howTo: [
      'Open Leaderboard after scoring sync.',
      'Review biggest mover, best pick, worst miss, and closest podium guess.',
    ],
  },
  {
    title: '10. Notifications (In-App)',
    howTo: [
      'Go to Dashboard -> Notifications to view recent events.',
      'Toggle email/push preferences in notification settings.',
      'Current system includes lock reminders, approvals, and score updates in-app.',
    ],
  },
  {
    title: '11. Pick History + Head-to-Head',
    howTo: [
      'Open Leaderboard and pick a member in Head-to-Head.',
      'Compare race-by-race points versus your opponent.',
    ],
  },
  {
    title: '12. Season Awards',
    howTo: [
      'Open Leaderboard and check Season Awards.',
      'Awards include most accurate, risk taker, and comeback of the year.',
    ],
  },
  {
    title: '13. Admin Simulation Tool',
    howTo: [
      'Open Admin -> Simulation.',
      'Run simulation with current scoring form values against past races.',
      'Review projected gainers/losers before saving scoring changes.',
    ],
  },
  {
    title: '14. Anti-Dead-Team Auto-Suggest',
    howTo: [
      'In Picks, if selected drivers show poor recent reliability, you will see warnings.',
      'Use suggested swaps to improve lineup stability before lock.',
    ],
  },
]

export function HowToUsePage() {
  return (
    <div className="app-shell">
      <section>
        <h2>How To Use F1 Total</h2>
        <p>
          This guide covers the currently enabled feature set, including groups and sign-in, group messages, team
          themes, picks, leaderboard, and admin tools.
        </p>
        <p>
          New player flow: sign in (you land on the Groups page), create or join a group, use &quot;Go to [group name]&quot; to
          enter the app, submit picks before lock, then follow leaderboard and recap cards each race week. You can join
          multiple groups and switch between them from the Groups page.
        </p>
        <p>
          Quick links: <Link to="/groups" className="inline-link">Groups</Link> |{' '}
          <Link to="/app/picks" className="inline-link">Picks</Link> |{' '}
          <Link to="/app/messages" className="inline-link">Messages</Link> |{' '}
          <Link to="/app/leaderboard" className="inline-link">Leaderboard</Link> |{' '}
          <Link to="/app/admin" className="inline-link">Admin</Link>
        </p>
      </section>

      <section>
        <h3>Feature Guide</h3>
        <div className="feature-grid">
          {featureGuides.map((guide) => (
            <article key={guide.title} className="feature-card">
              <h4>{guide.title}</h4>
              <ol className="how-list">
                {guide.howTo.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
