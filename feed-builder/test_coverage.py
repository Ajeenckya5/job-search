import unittest

from build_feeds import coverage_problems


def job(source, company):
    return {"source": source, "company": company, "title": "Engineer"}


class CoverageGateTest(unittest.TestCase):
    def test_rejects_a_thin_feed(self):
        problems = coverage_problems([job("ashby", "1X")])
        self.assertTrue(any("companies" in item for item in problems))
        self.assertTrue(any("jobs" in item for item in problems))
        self.assertTrue(any("greenhouse returned 0" in item for item in problems))

    def test_accepts_a_full_feed(self):
        jobs = []
        for source in ("greenhouse", "lever", "ashby", "remotive", "arbeitnow"):
            for index in range(400):
                jobs.append(job(source, f"{source}-{index}"))
        self.assertEqual(coverage_problems(jobs), [])


if __name__ == "__main__":
    unittest.main()
