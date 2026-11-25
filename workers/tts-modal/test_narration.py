"""Run: python3 -m unittest discover -s workers/tts-modal (needs num2words)."""

import unittest

from narration import speech_check, spoken_forms, spoken_sentence


class SpokenMoney(unittest.TestCase):
    def test_scale_word_after_the_amount_moves_the_currency_after_it(self):
        self.assertEqual(
            spoken_sentence("like one sale worth $1 million to $5 million."),
            "like one sale worth one million dollars to five million dollars.",
        )
        self.assertEqual(
            spoken_sentence("between $12.5 million and $58 million."),
            "between twelve point five million dollars and fifty-eight million dollars.",
        )

    def test_glued_scales(self):
        self.assertEqual(spoken_sentence("$1M,"), "one million dollars,")
        self.assertEqual(spoken_sentence("$1-M"), "one million dollars")
        self.assertEqual(spoken_sentence("$3.4bn."), "three point four billion dollars.")
        self.assertEqual(spoken_sentence("($60B)"), "(sixty billion dollars)")
        self.assertEqual(spoken_sentence("$2tn"), "two trillion dollars")

    def test_plain_amounts_cents_and_singular(self):
        self.assertEqual(spoken_sentence("$1"), "one dollar")
        self.assertEqual(spoken_sentence("$20 a month"), "twenty dollars a month")
        self.assertEqual(spoken_sentence("$5,000."), "five thousand dollars.")
        self.assertEqual(spoken_sentence("$19.99"), "nineteen dollars ninety-nine cents")
        self.assertEqual(spoken_sentence("$1.23"), "one dollar twenty-three cents")
        self.assertEqual(spoken_sentence("$1.00"), "one dollar")
        self.assertEqual(spoken_sentence("US$19.99"), "nineteen dollars ninety-nine cents")

    def test_other_currencies(self):
        self.assertEqual(spoken_sentence("€5 million"), "five million euros")
        self.assertEqual(spoken_sentence("£1"), "one pound")
        self.assertEqual(spoken_sentence("₹500"), "five hundred rupees")
        self.assertEqual(spoken_sentence("3 yuan"), "three yuan")

    def test_scale_word_is_not_joined_across_punctuation(self):
        self.assertEqual(spoken_sentence("$2. Million"), "two dollars. Million")
        self.assertEqual(spoken_sentence("$5 (million)"), "five dollars (million)")

    def test_one_spoken_string_per_token_so_word_timings_line_up(self):
        tokens = "worth $1 million to $5 million.".split()
        self.assertEqual(
            spoken_forms(tokens),
            ["WORTH", "ONE", "MILLION DOLLARS", "TO", "FIVE", "MILLION DOLLARS"],
        )


class SpokenNumbers(unittest.TestCase):
    def test_dates_are_ordinal_and_keep_their_comma(self):
        self.assertEqual(
            spoken_sentence("On November 23, the board brought him back"),
            "On November twenty-third, the board brought him back",
        )
        self.assertEqual(spoken_sentence("on 5 May"), "on fifth May")
        self.assertEqual(spoken_sentence("Sept. 1st"), "Sept. first")

    def test_years_counts_and_no_space_before_punctuation(self):
        self.assertEqual(
            spoken_sentence("37 members of Congress since January 2025."),
            "thirty-seven members of Congress since January twenty twenty-five.",
        )
        self.assertEqual(spoken_sentence("1,000,001 items,"), "one million one items,")
        self.assertEqual(spoken_sentence("it fell 48%."), "it fell forty-eight percent.")
        self.assertEqual(spoken_sentence("10x faster"), "ten times faster")
        self.assertEqual(spoken_sentence("2.5 hours"), "two point five hours")
        self.assertEqual(spoken_sentence("the 23rd"), "the twenty-third")

    def test_unit_letter_after_a_hyphen_stays_a_letter(self):
        self.assertEqual(spoken_forms(["64-M"]), ["SIXTY FOUR M"])


class SpeechCheck(unittest.TestCase):
    def test_expects_the_moved_currency_word(self):
        text = "worth $1 million."
        heard = "WORTHONEMILLIONDOLLARS"
        self.assertTrue(speech_check(text, heard, 1.5)["ok"])


if __name__ == "__main__":
    unittest.main()
