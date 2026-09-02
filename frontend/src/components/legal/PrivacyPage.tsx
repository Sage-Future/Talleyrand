import { FC, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import {
  getConsent,
  isAnalyticsConfigured,
  setConsent,
  subscribeConsent,
} from '../../services/analyticsConsent';
import { REPO_URL } from '../../config/constants';
import { CONTACT_EMAIL, LegalLayout, OPERATOR, POSTAL_ADDRESS } from './LegalLayout';

/**
 * The visitor's current analytics answer, changeable in place. Withdrawing
 * has to be as easy as accepting was, and this is the page that explains what
 * is being accepted, so the switch belongs here as much as in Settings.
 */
const AnalyticsChoice: FC = () => {
  const consent = useSyncExternalStore(subscribeConsent, getConsent);
  if (!isAnalyticsConfigured()) return null;

  const button =
    'underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900';

  return (
    <p className="not-prose my-6 rounded-xl border border-stone-200 bg-paper px-4 py-3 text-[14.5px] leading-relaxed text-stone-600">
      {consent === null &&
        'You have not answered yet, so analytics is off. The banner at the bottom of the page is where you answer.'}
      {consent === 'granted' && (
        <>
          Analytics is currently <strong className="text-stone-800">on</strong> in this browser.{' '}
          <button type="button" onClick={() => setConsent('denied')} className={button}>
            Turn it off
          </button>
        </>
      )}
      {consent === 'denied' && (
        <>
          Analytics is currently <strong className="text-stone-800">off</strong> in this browser.{' '}
          <button type="button" onClick={() => setConsent('granted')} className={button}>
            Turn it on
          </button>
        </>
      )}
    </p>
  );
};

export const PrivacyPage: FC = () => (
  <LegalLayout title="Privacy policy" updated="2 September 2026">
    <p>
      Talleyrand is a research tool made by {OPERATOR} ("Sage", "we"). This page says what the
      service at talleyrand.app stores about you, what it sends elsewhere, and how to get rid of it.
      It is short because there is not much to tell: there is no user database, your model API keys
      stay in your browser, and your cases live in exactly one place.
    </p>
    <p>
      It covers the hosted service at talleyrand.app only. The software is{' '}
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
        open source
      </a>
      , and anyone can run their own copy. A self-hosted copy is run by whoever hosts it, and this
      policy does not apply to it.
    </p>

    <h2 id="summary">The short version</h2>
    <ul>
      <li>
        You sign in with Google. We use your email address as your identity and store nothing else
        about you.
      </li>
      <li>
        Your cases, meaning the brief, every question and answer, your reactions, and any documents
        you attach, are stored in our database under your email address until you delete them.
      </li>
      <li>
        Each time you ask a question, the whole case goes to OpenAI or Anthropic under the API key
        you pasted into Settings. The key stays in your browser. Our server passes it through and
        never writes it down.
      </li>
      <li>Analytics runs only if you say yes.</li>
      <li>Delete your cases and nothing about you remains on our server.</li>
    </ul>

    <h2 id="what-we-store">What we store, and where</h2>

    <h3>Your cases</h3>
    <p>
      Each case is one record in our database, which is MongoDB hosted by MongoDB Atlas. A case
      record holds:
    </p>
    <ul>
      <li>the case name, the brief, and when the case was created;</li>
      <li>
        every question and answer, which model wrote each answer, and the web pages that answer's
        search consulted;
      </li>
      <li>the documents you attached: text files as text, PDFs as the file itself;</li>
      <li>
        your reactions: hearts, highlighted passages, and the suggestions you accepted or declined,
        with the reason you gave;
      </li>
      <li>which answers you have read, and when;</li>
      <li>whether the case is shared;</li>
      <li>your email address, as the owner.</li>
    </ul>
    <p>
      That last line is the only record that you have an account. There is no user table, no
      profile, and no login history.
    </p>

    <h3>Generation jobs</h3>
    <p>
      While an answer, a batch of suggestions, or a summary is being written, a second record tracks
      the job: which case and question it belongs to, its status, and its result. It exists so that
      closing the tab does not lose work in flight. It is deleted once your browser confirms it has
      received the result, and whenever its case is deleted.
    </p>

    <h3>What Google tells us when you sign in</h3>
    <p>
      Sign-in is Google OAuth, with the <em>openid</em>, <em>email</em>, and <em>profile</em>{' '}
      scopes. Google sends us your account ID, email address, name, and the address of your profile
      picture. We read them once, check that the email is verified, and discard Google's token. Your
      email becomes the owner of your cases. The ID, name, and picture address go only into the
      sign-in token kept in your browser and never reach our database.
    </p>

    <h3>In your browser</h3>
    <p>
      Talleyrand keeps a few things in your browser's local storage: your sign-in tokens, which
      expire after seven days without use; your OpenAI and Anthropic API keys; your settings, such
      as the default model and whether web search is on; and your answer to the analytics question.
      None of this is sent to our server except the keys, which travel with each request that needs
      one. Signing out removes the tokens and the keys.
    </p>
    <p>
      The service sets one cookie of its own, <code>oauth_state</code>, on our API domain, for ten
      minutes during sign-in, to protect the sign-in against forgery. No other cookie is set unless
      you accept analytics.
    </p>

    <h3>Server logs</h3>
    <p>
      Render, which hosts the site and the server, keeps request logs for a limited period. They
      record the time, the address of each request with any query string removed, the response code,
      and the IP address the request came from. They never contain the contents of a case or an API
      key, and our server does not log prompts or answers.
    </p>

    <table>
      <thead>
        <tr>
          <th>What</th>
          <th>Where</th>
          <th>For how long</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Cases</td>
          <td>Our database</td>
          <td>Until you delete them, plus up to eight days in daily backups</td>
        </tr>
        <tr>
          <td>Generation jobs</td>
          <td>Our database</td>
          <td>Until your browser confirms it received the result</td>
        </tr>
        <tr>
          <td>Sign-in tokens, API keys, settings</td>
          <td>Your browser</td>
          <td>Until you sign out; tokens expire after seven days unused</td>
        </tr>
        <tr>
          <td>Request logs</td>
          <td>Render</td>
          <td>A limited period, set by Render</td>
        </tr>
        <tr>
          <td>Analytics cookies, with your consent</td>
          <td>Your browser</td>
          <td>Up to two years, or until you withdraw consent</td>
        </tr>
      </tbody>
    </table>

    <h2 id="providers">What we send to others</h2>

    <h3 id="model-providers">OpenAI and Anthropic</h3>
    <p>
      Everything the model needs to answer is sent to the provider of the model you chose, under
      your own API key. That is the whole case, not only the current question: the brief, every
      question, every answer you have read, your highlights and hearts, the suggestions you declined
      and why, and the attached documents. PDFs attached to the case, or to the thread you are in,
      are sent as files. If web search is on, the provider performs the search. Dictation sends your
      recording to OpenAI for transcription. The kickstart, suggestions, summaries, reports, and
      automatic case names are produced by OpenAI.
    </p>
    <p>
      Your key is sent with each request, held in the server's memory only while that request or
      background job runs, and never written to our database or logs.
    </p>
    <p>
      Because these calls are made with your key on your own provider account, the provider's API
      terms, not ours, govern what it keeps. Both publish them:{' '}
      <a
        href="https://platform.openai.com/docs/guides/your-data"
        target="_blank"
        rel="noopener noreferrer"
      >
        OpenAI
      </a>{' '}
      and{' '}
      <a
        href="https://www.anthropic.com/legal/commercial-terms"
        target="_blank"
        rel="noopener noreferrer"
      >
        Anthropic
      </a>
      . On our side, your content is used for nothing except producing what you asked for. We do not
      train models on it, and we do not read your cases.
    </p>

    <h3 id="google">Google</h3>
    <ul>
      <li>
        <strong>Sign-in.</strong> Google knows that you signed in to Talleyrand, and when.
      </li>
      <li>
        <strong>Fonts.</strong> The site loads its two typefaces from Google Fonts. On every visit
        your browser fetches them from Google's servers, which see your IP address and the page that
        asked for them.
      </li>
      <li id="analytics" className="scroll-mt-24">
        <strong>Analytics, only with your consent.</strong> If you click Accept in the banner,
        Google Analytics sets cookies (<code>_ga</code> and <code>_ga_…</code>, lasting up to two
        years) and reports which pages and features are used, and roughly where from. It never
        receives your questions, answers, documents, or email. If you decline, or never answer,
        nothing loads. You can change your answer at any time here, or in Settings under Privacy.
        Withdrawing consent also deletes the cookies.
      </li>
    </ul>
    <AnalyticsChoice />

    <h3>Hosting</h3>
    <p>
      The site and the server run on Render. The database runs on MongoDB Atlas. Your data is stored
      and processed in the United States. If you are in the EU or the UK, that is a transfer outside
      your region; it is covered by the EU and UK standard contractual clauses in each provider's
      data processing agreement, and MongoDB is also certified under the EU-US Data Privacy
      Framework.
    </p>

    <h2 id="sharing">Shared cases</h2>
    <p>
      Sharing a case makes it readable by anyone who has the link, and lets them copy it into their
      own account. The shared page shows the entire case, attached documents included, but never
      your email or name, and which answers you have read stays private. Turning sharing off makes
      the link stop working at once. Copies other people already made are theirs and are not
      affected. The demo cases linked from the home page are ours, not a user's.
    </p>

    <h2 id="deletion">Deleting your data</h2>
    <ul>
      <li>
        <strong>One case.</strong> Use the delete action next to it in the sidebar. The case and its
        generation jobs are removed from the database immediately. There is no undo.
      </li>
      <li>
        <strong>Everything.</strong> Delete every case. Because we have no user table, that leaves
        nothing about you on our server. Sign out afterwards to clear the tokens and keys from your
        browser.
      </li>
      <li>
        <strong>There is no "delete account" button yet.</strong> If you would rather we do it, or
        want confirmation that nothing remains, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will handle it within two
        weeks.
      </li>
    </ul>
    <p>
      The database is backed up so that a failure on our side cannot lose everyone's work: MongoDB
      Atlas takes one snapshot a day and keeps the last eight. A deleted case therefore lingers in
      those snapshots for up to eight days before it is gone for good. Backups are only ever used to
      recover the whole database after a failure, never to bring back an individual case.
    </p>

    <h2 id="export">Taking your data with you</h2>
    <p>
      Every case can be exported as a JSON file from the sidebar and imported again later, on
      talleyrand.app or on a self-hosted copy. Reports can be downloaded as Markdown.
    </p>

    <h2 id="rights">Your rights</h2>
    <p>
      Wherever you live, you can ask us to show, correct, export, or delete the data we hold about
      you, object to how we use it, and withdraw your consent to analytics at any time. Most of this
      you can do yourself, as described above. For the rest, email{' '}
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If you are in the EU or the UK, you
      also have the right to complain to your data protection authority.
    </p>
    <p>
      For readers who need the legal basis under the GDPR: we process your cases and your email to
      provide the service you asked for (contract); analytics on your consent; and logs and rate
      limits to keep the service secure (legitimate interest). We do not sell personal data, show
      advertising, or profile you.
    </p>
    <p>
      The controller is {OPERATOR}, {POSTAL_ADDRESS}.
    </p>

    <h2 id="children">Children</h2>
    <p>
      Talleyrand is not intended for anyone under 18, and we do not knowingly collect data from
      children. If you believe a child has used it, email us and we will delete what we hold.
    </p>

    <h2 id="changes">Changes to this policy</h2>
    <p>
      When this policy changes, we update the date at the top. If a change matters, such as new data
      being collected or a new recipient, we will tell you in the app before it takes effect.
    </p>

    <h2 id="contact">Contact</h2>
    <p>
      Questions about privacy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Bugs and
      feature requests:{' '}
      <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
      . The <Link to="/terms">terms of service</Link> cover the rest of the relationship.
    </p>
  </LegalLayout>
);
