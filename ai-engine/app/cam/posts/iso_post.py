from typing import List
from .base_post import BasePostProcessor

class IsoPostProcessor(BasePostProcessor):
    """
    Conservative ISO 6983 / EIA RS-274-D compatible baseline word-address post-processor.
    
    Note: While EIA RS-274-D (American national standard / EIA tape format) and ISO 6983 
    (International NC standard) share word-address conventions, they are distinct standards 
    with differences in block structure, addressing syntax, and optional words.
    
    This class emits conservative word-address NC programs and must ONLY be used for 
    machine and controller profiles that explicitly declare compatibility with this baseline format.
    NC export is blocked for unvalidated machine configurations.
    """
    pass
