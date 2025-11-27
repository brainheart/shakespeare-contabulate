#!/usr/bin/env python3
"""Add standard abbreviations to play_metadata.json"""

import json
from pathlib import Path

# Standard Shakespeare play abbreviations
ABBREVIATIONS = {
    "A Midsummer Night's Dream": "MND",
    "All's Well That Ends Well": "AWW",
    "Antony and Cleopatra": "ANT",
    "As You Like It": "AYL",
    "Coriolanus": "COR",
    "Cymbeline": "CYM",
    "Hamlet": "HAM",
    "Henry IV, Part 1": "1H4",
    "Henry IV, Part 2": "2H4",
    "Henry V": "H5",
    "Henry VI, Part 1": "1H6",
    "Henry VI, Part 2": "2H6",
    "Henry VI, Part 3": "3H6",
    "Henry VIII": "H8",
    "Julius Caesar": "JC",
    "King John": "JN",
    "King Lear": "LR",
    "Love's Labour's Lost": "LLL",
    "Macbeth": "MAC",
    "Measure for Measure": "MM",
    "Much Ado About Nothing": "ADO",
    "Othello": "OTH",
    "Pericles": "PER",
    "Richard II": "R2",
    "Richard III": "R3",
    "Romeo and Juliet": "ROM",
    "The Comedy of Errors": "ERR",
    "The Merchant of Venice": "MV",
    "The Merry Wives of Windsor": "WIV",
    "The Taming of the Shrew": "SHR",
    "The Tempest": "TMP",
    "The Two Gentlemen of Verona": "TGV",
    "The Winter's Tale": "WT",
    "Timon of Athens": "TIM",
    "Titus Andronicus": "TIT",
    "Troilus and Cressida": "TRO",
    "Twelfth Night": "TN"
}

def main():
    metadata_path = Path(__file__).parent / "play_metadata.json"
    
    with open(metadata_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Add abbreviations
    for play in data['plays']:
        title = play['title']
        if title in ABBREVIATIONS:
            play['abbr'] = ABBREVIATIONS[title]
        else:
            print(f"Warning: No abbreviation found for '{title}'")
    
    # Write back with nice formatting
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"Added abbreviations to {len(data['plays'])} plays")

if __name__ == '__main__':
    main()
