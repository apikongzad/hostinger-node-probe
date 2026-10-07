export const dynamic = "force-dynamic";

export default function Page() {
  const time = new Date().toISOString();
  console.log(`[next-bare] page / ${time}`);
  return (
    <>
      <h1>hello from next bare</h1>
      <p>{time}</p>
    </>
  );
}
