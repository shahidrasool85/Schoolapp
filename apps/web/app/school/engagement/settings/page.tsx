"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, LoadingState, PageError, PageHeader, SectionCard } from "../../../../components/ui";
import { api } from "../../../../lib/api";
import { userFacingError } from "../../../../lib/errors";

type Settings = {
  rewardsEnabled: boolean;
  achievementsEnabled: boolean;
  competitionsEnabled: boolean;
  leaderboardsEnabled: boolean;
  earlyLearningEnabled: boolean;
  xpEnabled: boolean;
  studentVisiblePoints: boolean;
  parentVisiblePoints: boolean;
  allowIndividualLeaderboard: boolean;
  allowClassLeaderboard: boolean;
  allowHouseLeaderboard: boolean;
  anonymisePupilLeaderboard: boolean;
  leaderboardDisplayNamePolicy: string;
  grantRewardPointsOnLearning: boolean;
};

type Payload = { settings: Settings; yearGroups: Array<{ yearGroupId: string; code: string; name: string; policy: Record<string, boolean | null> }> };

const YEAR_POLICY_FIELDS = [
  { key: "rewardsEnabled", label: "Rewards" },
  { key: "earlyLearningEnabled", label: "Early learning" },
  { key: "parentAssistedMode", label: "Parent-assisted learning" },
  { key: "childFriendlyUi", label: "Child-friendly UI" },
  { key: "learningChallengesEnabled", label: "Learning challenges" },
  { key: "competitionsEnabled", label: "Competitions" },
  { key: "leaderboardsEnabled", label: "Leaderboards" },
] as const;

export default function EngagementSettingsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api<Payload>("/api/v1/engagement/settings")
      .then(setData)
      .catch((err: Error) => setError(userFacingError(err, "Could not load settings.")));
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    const body = {
      rewardsEnabled: form.get("rewardsEnabled") === "on",
      competitionsEnabled: form.get("competitionsEnabled") === "on",
      leaderboardsEnabled: form.get("leaderboardsEnabled") === "on",
      earlyLearningEnabled: form.get("earlyLearningEnabled") === "on",
      xpEnabled: form.get("xpEnabled") === "on",
      allowIndividualLeaderboard: form.get("allowIndividualLeaderboard") === "on",
      allowClassLeaderboard: form.get("allowClassLeaderboard") === "on",
      allowHouseLeaderboard: form.get("allowHouseLeaderboard") === "on",
      anonymisePupilLeaderboard: form.get("anonymisePupilLeaderboard") === "on",
      grantRewardPointsOnLearning: form.get("grantRewardPointsOnLearning") === "on",
      leaderboardDisplayNamePolicy: String(form.get("leaderboardDisplayNamePolicy") || "first_name_initial"),
    };
    const updated = await api<{ settings: Settings }>("/api/v1/engagement/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setData({ ...data, settings: updated.settings });
    setSaved("School settings saved.");
  }

  async function saveYear(yearGroupId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bool = (name: string) => (form.get(name) === "" ? null : form.get(name) === "true");
    await api(`/api/v1/engagement/year-groups/${yearGroupId}`, {
      method: "PUT",
      body: JSON.stringify({
        earlyLearningEnabled: bool("earlyLearningEnabled"),
        parentAssistedMode: bool("parentAssistedMode"),
        childFriendlyUi: bool("childFriendlyUi"),
        leaderboardsEnabled: bool("leaderboardsEnabled"),
        learningChallengesEnabled: bool("learningChallengesEnabled"),
        competitionsEnabled: bool("competitionsEnabled"),
        rewardsEnabled: bool("rewardsEnabled"),
      }),
    });
    setSaved("Year-group policy saved.");
  }

  if (error) return <PageError title="Settings unavailable" description={error} />;
  if (!data) return <LoadingState label="Loading settings…" />;

  return (
    <>
      <PageHeader title="Engagement settings" description="Schools control rewards, early learning, and leaderboard privacy. Student Portal enablement stays on the existing Student portal policy page." />
      {saved ? <Alert>{saved}</Alert> : null}
      <SectionCard title="School defaults">
        <form onSubmit={(event) => void saveSettings(event)}>
          <label><input type="checkbox" name="rewardsEnabled" defaultChecked={data.settings.rewardsEnabled} /> Rewards</label>
          <label><input type="checkbox" name="earlyLearningEnabled" defaultChecked={data.settings.earlyLearningEnabled} /> Early learning</label>
          <label><input type="checkbox" name="xpEnabled" defaultChecked={data.settings.xpEnabled} /> Learning XP (separate from reward points)</label>
          <label><input type="checkbox" name="competitionsEnabled" defaultChecked={data.settings.competitionsEnabled} /> Competitions</label>
          <label><input type="checkbox" name="leaderboardsEnabled" defaultChecked={data.settings.leaderboardsEnabled} /> Leaderboards</label>
          <label><input type="checkbox" name="allowHouseLeaderboard" defaultChecked={data.settings.allowHouseLeaderboard} /> House leaderboard</label>
          <label><input type="checkbox" name="allowClassLeaderboard" defaultChecked={data.settings.allowClassLeaderboard} /> Class leaderboard</label>
          <label><input type="checkbox" name="allowIndividualLeaderboard" defaultChecked={data.settings.allowIndividualLeaderboard} /> Individual leaderboard (off by default for younger pupils)</label>
          <label><input type="checkbox" name="anonymisePupilLeaderboard" defaultChecked={data.settings.anonymisePupilLeaderboard} /> Anonymise pupil names</label>
          <label><input type="checkbox" name="grantRewardPointsOnLearning" defaultChecked={data.settings.grantRewardPointsOnLearning} /> Also grant reward points when practice is completed (off unless the school wants this)</label>
          <label>
            Display names
            <select name="leaderboardDisplayNamePolicy" defaultValue={data.settings.leaderboardDisplayNamePolicy}>
              <option value="first_name_initial">First name + surname initial</option>
              <option value="first_name">First name only</option>
              <option value="anonymous_alias">Anonymous alias</option>
              <option value="rank_only">Rank only</option>
            </select>
          </label>
          <Button type="submit">Save school settings</Button>
        </form>
      </SectionCard>
      <SectionCard title="Year-group policy">
        <p className="muted">Leave inherit (blank) unless this year group should differ from the school default. Do not hard-code age bans.</p>
        {data.yearGroups.map((group) => (
          <form key={group.yearGroupId} className="card" onSubmit={(event) => void saveYear(group.yearGroupId, event)}>
            <h3>{group.name}</h3>
            {YEAR_POLICY_FIELDS.map(({ key, label }) => (
              <label key={key}>
                {label}
                <select name={key} defaultValue={group.policy[key] == null ? "" : String(group.policy[key])}>
                  <option value="">Inherit</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
            ))}
            <Button type="submit" variant="secondary">Save {group.code}</Button>
          </form>
        ))}
      </SectionCard>
    </>
  );
}
