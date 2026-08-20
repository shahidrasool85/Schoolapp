import { ComingLaterCard } from "../../../components/coming-later";

export default function StudentLearningPage() {
  return (
    <>
      <h1>My Learning</h1>
      <ComingLaterCard
        title="Learning activities"
        message="Homework, quizzes and challenges will appear here in a later phase."
      />
    </>
  );
}
