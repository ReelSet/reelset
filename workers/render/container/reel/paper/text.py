import re

GREEK = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "theta": "θ",
    "lambda": "λ", "mu": "μ", "pi": "π", "sigma": "σ", "tau": "τ", "phi": "φ", "omega": "ω",
    "eta": "η", "rho": "ρ", "kappa": "κ", "Delta": "Δ", "Sigma": "Σ", "Omega": "Ω", "Theta": "Θ",
}
_LATEX_PLAIN = [
    (r"\\pm", "±"),
    (r"\\mp", "∓"),
    (r"\\times", "×"),
    (r"\\downarrow", "↓"),
    (r"\\uparrow", "↑"),
    (r"\\%", "%"),
    (r"\\uparrow", "↑"),
    (r"\\rightarrow|\\to\b", "→"),
    (r"\\leq?\b", "≤"),
    (r"\\geq?\b", "≥"),
    (r"\\approx", "≈"),
    (r"\\cdot", "·"),
    (r"\\,|\;|\\!|\\ |\\quad|\\qquad", " "),
    (r"\\ast|\\star", "*"),
    (r"\\dagger", "†"),
    (r"\\ddagger", "‡"),
    (r"\\&", "&"),
    (r"\\_", "_"),
]
_WRAPPERS = re.compile(
    r"\\(?:mathbf|mathrm|textbf|text|mathit|textit|mathsf|mathtt|boldsymbol|bm|mathcal|operatorname)\s*\{([^{}]*)\}"
)
BOLD_MATH = re.compile(r"\\(?:mathbf|textbf|boldsymbol|bm)\b")


def latex_to_plain(latex: str) -> str:
    s = latex
    for _ in range(3):
        s = _WRAPPERS.sub(r"\1", s)
    for pattern, repl in _LATEX_PLAIN:
        s = re.sub(pattern, repl, s)
    s = re.sub(r"\\([A-Za-z]+)", lambda m: GREEK.get(m.group(1), m.group(0)), s)
    s = re.sub(r"\^\{?\s*([*†‡]+)\s*\}?", r"\1", s)
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", s).strip()


def tidy(text: str) -> str:
    """Collapse whitespace and the gaps left behind when citations are removed."""
    t = re.sub(r"[ \t\r\f\v]+", " ", text)
    t = re.sub(r"\(\s*[,;\s]*\)", "", t)
    t = re.sub(r"\[\s*[,;\s]*\]", "", t)
    t = re.sub(r" +([,.;:!?)])", r"\1", t)
    t = re.sub(r"([(\[]) +", r"\1", t)
    t = re.sub(r" *\n *", "\n", t)
    return re.sub(r" {2,}", " ", t).strip()


def plain(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()
