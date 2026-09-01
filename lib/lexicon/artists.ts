/* ------------------------------------------------------------------
   The artist index.

   Deliberately far wider than the clip library. With twenty clips and a
   dropdown of a dozen names, the game is solved by reading rather than
   listening — this list is what stops that. Adding clips never requires
   touching it.

   Grouped by instrument because that is how the names come to mind, not
   because the grouping means anything: any of them can be the name a
   record was released under.
   ------------------------------------------------------------------ */

export const ARTISTS: string[] = [
  // Trumpet, cornet, flugelhorn
  "Louis Armstrong", "Bix Beiderbecke", "Red Allen", "Rex Stewart", "Cootie Williams",
  "Buck Clayton", "Harry Edison", "Roy Eldridge", "Bobby Hackett", "Charlie Shavers",
  "Dizzy Gillespie", "Fats Navarro", "Miles Davis", "Clifford Brown", "Kenny Dorham",
  "Art Farmer", "Chet Baker", "Donald Byrd", "Lee Morgan", "Freddie Hubbard",
  "Blue Mitchell", "Booker Little", "Woody Shaw", "Thad Jones", "Nat Adderley",
  "Bill Hardman", "Clark Terry", "Maynard Ferguson", "Shorty Rogers", "Conte Candoli",
  "Don Cherry", "Ruby Braff", "Jon Faddis", "Randy Brecker", "Arturo Sandoval",
  "Wynton Marsalis", "Terence Blanchard", "Roy Hargrove", "Tom Harrell", "Dave Douglas",
  "Kenny Wheeler", "Enrico Rava", "Ingrid Jensen", "Ambrose Akinmusire", "Avishai Cohen",
  "Marquis Hill", "Keyon Harrold",

  // Tenor saxophone
  "Coleman Hawkins", "Lester Young", "Ben Webster", "Don Byas", "Illinois Jacquet",
  "Arnett Cobb", "Lucky Thompson", "Budd Johnson", "Dexter Gordon", "Wardell Gray",
  "Gene Ammons", "Sonny Stitt", "Sonny Rollins", "John Coltrane", "Hank Mobley",
  "Johnny Griffin", "Eddie Lockjaw Davis", "Stanley Turrentine", "Booker Ervin",
  "Joe Henderson", "Wayne Shorter", "Clifford Jordan", "Harold Land", "Teddy Edwards",
  "Jimmy Heath", "Benny Golson", "George Coleman", "Charlie Rouse", "Yusef Lateef",
  "Paul Gonsalves", "Frank Foster", "Frank Wess", "Zoot Sims", "Al Cohn", "Stan Getz",
  "Archie Shepp", "Pharoah Sanders", "Albert Ayler", "Charles Lloyd", "Dewey Redman",
  "David Murray", "Von Freeman", "Houston Person", "Michael Brecker", "Bob Berg",
  "Bob Mintzer", "Ernie Watts", "Joe Lovano", "Branford Marsalis", "Joshua Redman",
  "Chris Potter", "Mark Turner", "Ravi Coltrane", "Seamus Blake", "Melissa Aldana",
  "Kamasi Washington", "Walter Smith III", "Shabaka Hutchings", "Nubya Garcia",

  // Alto saxophone
  "Johnny Hodges", "Benny Carter", "Willie Smith", "Charlie Parker", "Sonny Criss",
  "Frank Morgan", "Jackie McLean", "Lou Donaldson", "Cannonball Adderley", "Phil Woods",
  "Art Pepper", "Lee Konitz", "Paul Desmond", "Bud Shank", "Herb Geller",
  "Charlie Mariano", "Hank Crawford", "Ornette Coleman", "Eric Dolphy", "Marion Brown",
  "Gary Bartz", "David Sanborn", "Bobby Watson", "Kenny Garrett", "Steve Coleman",
  "Greg Osby", "John Zorn", "Tim Berne", "Vincent Herring", "Rudresh Mahanthappa",
  "Miguel Zenon", "Steve Lehman", "Immanuel Wilkins", "Lakecia Benjamin",

  // Soprano and baritone saxophone
  "Sidney Bechet", "Steve Lacy", "Dave Liebman", "Jane Ira Bloom", "Harry Carney",
  "Serge Chaloff", "Gerry Mulligan", "Pepper Adams", "Cecil Payne", "Ronnie Cuber",
  "Hamiet Bluiett", "Gary Smulyan",

  // Trombone
  "Jack Teagarden", "Vic Dickenson", "Lawrence Brown", "Tommy Dorsey", "J.J. Johnson",
  "Kai Winding", "Bennie Green", "Curtis Fuller", "Slide Hampton", "Jimmy Knepper",
  "Bob Brookmeyer", "Frank Rosolino", "Carl Fontana", "Urbie Green", "Bill Watrous",
  "Grachan Moncur III", "Roswell Rudd", "Albert Mangelsdorff", "Ray Anderson",
  "Steve Turre", "Robin Eubanks", "Wycliffe Gordon", "Conrad Herwig",

  // Piano
  "Jelly Roll Morton", "James P. Johnson", "Fats Waller", "Earl Hines", "Art Tatum",
  "Teddy Wilson", "Duke Ellington", "Count Basie", "Mary Lou Williams", "Nat King Cole",
  "Bud Powell", "Thelonious Monk", "Al Haig", "Hank Jones", "Tommy Flanagan",
  "Barry Harris", "Red Garland", "Wynton Kelly", "Sonny Clark", "Bill Evans",
  "Horace Silver", "Bobby Timmons", "Cedar Walton", "Kenny Drew", "Duke Pearson",
  "Horace Parlan", "Elmo Hope", "Herbie Nichols", "Randy Weston", "Abdullah Ibrahim",
  "Ahmad Jamal", "Oscar Peterson", "Erroll Garner", "George Shearing", "Dave Brubeck",
  "Vince Guaraldi", "Ramsey Lewis", "Les McCann", "Gene Harris", "Junior Mance",
  "Monty Alexander", "McCoy Tyner", "Herbie Hancock", "Chick Corea", "Keith Jarrett",
  "Paul Bley", "Andrew Hill", "Cecil Taylor", "Don Pullen", "Muhal Richard Abrams",
  "Joe Zawinul", "Joe Sample", "Kenny Barron", "Mulgrew Miller", "James Williams",
  "Geri Allen", "Marcus Roberts", "Michel Petrucciani", "Martial Solal", "Bobo Stenson",
  "Esbjorn Svensson", "Tord Gustavsen", "Gonzalo Rubalcaba", "Danilo Perez",
  "Chucho Valdes", "Eddie Palmieri", "Fred Hersch", "Bill Charlap", "Benny Green",
  "Brad Mehldau", "Jason Moran", "Vijay Iyer", "Robert Glasper", "Craig Taborn",
  "Ethan Iverson", "Hiromi", "Aaron Parks", "Kris Davis", "Sullivan Fortner",
  "Jon Batiste", "Gerald Clayton", "Joey Alexander",

  // Bass
  "Jimmy Blanton", "Milt Hinton", "Slam Stewart", "Israel Crosby", "Oscar Pettiford",
  "Ray Brown", "Percy Heath", "Wilbur Ware", "Paul Chambers", "Doug Watkins",
  "Sam Jones", "Leroy Vinnegar", "Red Mitchell", "Charles Mingus", "Scott LaFaro",
  "Gary Peacock", "Charlie Haden", "Jimmy Garrison", "Reggie Workman", "Richard Davis",
  "Ron Carter", "Cecil McBee", "Buster Williams", "Eddie Gomez", "Miroslav Vitous",
  "Dave Holland", "Niels-Henning Orsted Pedersen", "Rufus Reid", "Ray Drummond",
  "Steve Swallow", "Jaco Pastorius", "Stanley Clarke", "Marcus Miller",
  "Christian McBride", "John Patitucci", "Larry Grenadier", "Avishai Cohen (bass)",
  "Esperanza Spalding", "Linda May Han Oh", "Ben Williams", "Matt Brewer",

  // Drums
  "Baby Dodds", "Chick Webb", "Gene Krupa", "Jo Jones", "Sid Catlett", "Buddy Rich",
  "Kenny Clarke", "Max Roach", "Art Blakey", "Philly Joe Jones", "Roy Haynes",
  "Shelly Manne", "Chico Hamilton", "Connie Kay", "Jimmy Cobb", "Louis Hayes",
  "Pete La Roca", "Elvin Jones", "Tony Williams", "Joe Chambers", "Billy Higgins",
  "Ed Blackwell", "Paul Motian", "Ben Riley", "Mel Lewis", "Jack DeJohnette",
  "Al Foster", "Billy Hart", "Andrew Cyrille", "Sunny Murray", "Rashied Ali",
  "Milford Graves", "Han Bennink", "Peter Erskine", "Steve Gadd",
  "Jeff Tain Watts", "Brian Blade", "Bill Stewart", "Antonio Sanchez",
  "Terri Lyne Carrington", "Cindy Blackman Santana", "Eric Harland", "Marcus Gilmore",
  "Nate Smith", "Makaya McCraven", "Justin Faulkner",

  // Guitar
  "Eddie Lang", "Django Reinhardt", "Charlie Christian", "Oscar Moore", "Freddie Green",
  "Tiny Grimes", "Barney Kessel", "Tal Farlow", "Jimmy Raney", "Herb Ellis",
  "Kenny Burrell", "Wes Montgomery", "Grant Green", "Jim Hall", "Joe Pass",
  "George Benson", "Pat Martino", "Larry Coryell", "John McLaughlin", "Al Di Meola",
  "Pat Metheny", "John Abercrombie", "Ralph Towner", "John Scofield", "Mike Stern",
  "Bill Frisell", "Emily Remler", "Russell Malone", "Mark Whitfield",
  "Peter Bernstein", "Kurt Rosenwinkel", "Charlie Hunter", "Lage Lund",
  "Gilad Hekselman", "Mary Halvorson", "Julian Lage",

  // Vibraphone, organ
  "Lionel Hampton", "Red Norvo", "Milt Jackson", "Terry Gibbs", "Cal Tjader",
  "Bobby Hutcherson", "Gary Burton", "Walt Dickerson", "Roy Ayers", "Stefon Harris",
  "Joe Locke", "Warren Wolf",
  "Wild Bill Davis", "Jimmy Smith", "Jack McDuff", "Jimmy McGriff", "Shirley Scott",
  "Larry Young", "Don Patterson", "Charles Earland", "Dr. Lonnie Smith",
  "Joey DeFrancesco", "Barbara Dennerlein", "Cory Henry",

  // Clarinet, flute, violin
  "Johnny Dodds", "Jimmie Noone", "Benny Goodman", "Artie Shaw", "Barney Bigard",
  "Edmond Hall", "Pee Wee Russell", "Buddy DeFranco", "Jimmy Giuffre", "Tony Scott",
  "Eddie Daniels", "Don Byron", "Anat Cohen",
  "Herbie Mann", "James Moody", "Hubert Laws", "Jeremy Steig", "Bobbi Humphrey",
  "Joe Venuti", "Stephane Grappelli", "Stuff Smith", "Ray Nance", "Jean-Luc Ponty",
  "Billy Bang", "Regina Carter", "Mark Feldman",

  // Voice
  "Ella Fitzgerald", "Billie Holiday", "Sarah Vaughan", "Anita O'Day", "Carmen McRae",
  "Betty Carter", "Mel Torme", "Jon Hendricks", "Eddie Jefferson", "Bobby McFerrin",
  "Kurt Elling", "Cecile McLorin Salvant", "Gregory Porter",
];

/**
 * Alternate spellings and given names that should count as correct.
 * Keyed by the canonical entry above.
 */
export const ARTIST_ALIASES: Record<string, string[]> = {
  "Cannonball Adderley": ["Julian Adderley", "Julian Cannonball Adderley"],
  "John Coltrane": ["Trane", "J. Coltrane"],
  "Charlie Parker": ["Bird", "Charlie 'Bird' Parker", "Yardbird"],
  "Thelonious Monk": ["Monk"],
  "Miles Davis": ["Miles"],
  "Duke Ellington": ["Edward Kennedy Ellington"],
  "Count Basie": ["William Basie"],
  "Eddie Lockjaw Davis": ["Eddie Lockjaw Davis", "Lockjaw Davis", "Eddie Davis"],
  "Philly Joe Jones": ["Joe Jones (Philly)"],
  "Jeff Tain Watts": ["Jeff Watts", "Tain Watts"],
  "Dizzy Gillespie": ["John Birks Gillespie", "Dizzy"],
  "Louis Armstrong": ["Satchmo", "Pops"],
  "Lester Young": ["Prez", "Pres"],
  "Coleman Hawkins": ["Hawk", "Bean"],
  "Bix Beiderbecke": ["Leon Bismark Beiderbecke"],
  "Sonny Rollins": ["Theodore Rollins", "Newk"],
  "Bud Powell": ["Earl Powell"],
  "Art Tatum": ["Arthur Tatum"],
  "Niels-Henning Orsted Pedersen": ["NHOP", "Niels-Henning Ørsted Pedersen"],
  "Esbjorn Svensson": ["Esbjörn Svensson"],
  "Miguel Zenon": ["Miguel Zenón"],
  "Danilo Perez": ["Danilo Pérez"],
  "Chucho Valdes": ["Chucho Valdés"],
  "Stephane Grappelli": ["Stéphane Grappelli"],
  "Cecile McLorin Salvant": ["Cécile McLorin Salvant"],
  "Mel Torme": ["Mel Tormé"],
  "Eddie Gomez": ["Eddie Gómez"],
  "Miroslav Vitous": ["Miroslav Vitouš"],
  "Antonio Sanchez": ["Antonio Sánchez"],
  "Avishai Cohen (bass)": ["Avishai Cohen"],
  "Dr. Lonnie Smith": ["Lonnie Smith"],
  "J.J. Johnson": ["JJ Johnson", "James Louis Johnson"],
  "Grachan Moncur III": ["Grachan Moncur"],
  "Walter Smith III": ["Walter Smith"],
};
