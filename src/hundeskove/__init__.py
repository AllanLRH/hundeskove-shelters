"""Find shelters in Danish off-leash dog forests and check booking availability."""

__all__ = ["__version__", "CONTACT", "USER_AGENT"]

__version__ = "0.1.0"

#: Where the operator of a running instance can be reached.
#:
#: Every request this project makes goes to someone else's server, none of them
#: through a documented API. Identifying the client honestly is what lets those
#: operators throttle it gracefully, or ask it to stop, instead of having to
#: guess at anonymous traffic. Change this if you deploy your own instance.
CONTACT = "allan.lrh@gmail.com"

HOMEPAGE = "https://github.com/allanlrh/hundeskove"

#: Sent on every outbound request. Deliberately not disguised as a browser: a
#: fake Chrome string would hide an automated client from the people running the
#: services it depends on, which is the opposite of what a well-behaved deployed
#: instance wants.
USER_AGENT = f"hundeskove/{__version__} (+{HOMEPAGE}; {CONTACT})"
