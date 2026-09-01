/* ------------------------------------------------------------------
   The title index: standards from the Great American Songbook plus the
   jazz repertoire proper. Same purpose as the soloist list — the answer
   has to hide somewhere.
   ------------------------------------------------------------------ */

export const SONGS: string[] = [
  // Standards
  "All The Things You Are", "All Of Me", "All Of You", "Alone Together", "Angel Eyes",
  "April In Paris", "Autumn In New York", "Autumn Leaves", "Beautiful Love",
  "Bewitched, Bothered And Bewildered", "Blame It On My Youth", "Blue Moon",
  "Body And Soul", "But Not For Me", "Bye Bye Blackbird", "Caravan", "Cherokee",
  "Come Rain Or Come Shine", "Darn That Dream", "Days Of Wine And Roses",
  "Dearly Beloved", "Deep Purple", "Detour Ahead", "Do Nothin' Till You Hear From Me",
  "Don't Blame Me", "Don't Get Around Much Anymore", "East Of The Sun",
  "Easy Living", "Embraceable You", "Emily", "Everything Happens To Me",
  "Falling In Love With Love", "Fools Rush In", "For All We Know", "Get Happy",
  "God Bless The Child", "Have You Met Miss Jones", "Here's That Rainy Day",
  "How Deep Is The Ocean", "How High The Moon", "I Can't Get Started",
  "I Could Write A Book", "I Fall In Love Too Easily", "I Get A Kick Out Of You",
  "I Got It Bad And That Ain't Good", "I Got Rhythm", "I Hear A Rhapsody",
  "I Love You", "I Remember Clifford", "I Should Care", "I Thought About You",
  "If I Were A Bell", "I'll Remember April", "I'm Old Fashioned", "In A Mellow Tone",
  "In A Sentimental Mood", "Indiana", "Invitation", "It Could Happen To You",
  "It Don't Mean A Thing", "It Might As Well Be Spring", "It's Only A Paper Moon",
  "Just Friends", "Just One Of Those Things", "Laura", "Like Someone In Love",
  "Lover Man", "Lullaby Of Birdland", "Mean To Me", "Misty", "Moonlight In Vermont",
  "More Than You Know", "My Foolish Heart", "My Funny Valentine", "My Old Flame",
  "My One And Only Love", "My Romance", "My Shining Hour", "Nature Boy",
  "Nice Work If You Can Get It", "Night And Day", "Old Folks", "On Green Dolphin Street",
  "Out Of Nowhere", "Over The Rainbow", "Polka Dots And Moonbeams", "Prelude To A Kiss",
  "Round Midnight", "Satin Doll", "Secret Love", "Skylark", "Smoke Gets In Your Eyes",
  "So In Love", "Softly As In A Morning Sunrise", "Someday My Prince Will Come",
  "Sophisticated Lady", "Speak Low", "Star Eyes", "Stardust", "Stella By Starlight",
  "Stompin' At The Savoy", "Summertime", "Sweet Georgia Brown", "Take The A Train",
  "Tea For Two", "The Man I Love", "The Nearness Of You", "The Song Is You",
  "There Is No Greater Love", "There Will Never Be Another You", "These Foolish Things",
  "They Can't Take That Away From Me", "Three Little Words", "Time After Time",
  "'Tis Autumn", "What Is This Thing Called Love", "What's New", "When I Fall In Love",
  "Where Or When", "Willow Weep For Me", "Yesterdays", "You And The Night And The Music",
  "You Don't Know What Love Is", "You Go To My Head", "You Stepped Out Of A Dream",

  // Ellington and Strayhorn
  "Chelsea Bridge", "Come Sunday", "Cotton Tail", "Concerto For Cootie", "Day Dream",
  "Harlem Air Shaft", "In A Silent Way", "Isfahan", "Ko-Ko", "Lush Life",
  "Main Stem", "Mood Indigo", "Perdido", "Rockin' In Rhythm", "Solitude",
  "The Mooche", "Warm Valley", "Diminuendo And Crescendo In Blue", "Black And Tan Fantasy",
  "Blood Count", "Johnny Come Lately", "Passion Flower", "Raincheck", "Upper Manhattan Medical Group",

  // Bebop
  "Anthropology", "Au Privave", "Billie's Bounce", "Bird Feathers", "Bloomdido",
  "Blues For Alice", "Confirmation", "Cool Blues", "Dewey Square", "Donna Lee",
  "Groovin' High", "Half Nelson", "Hot House", "Kim", "Ko Ko", "Moose The Mooche",
  "Now's The Time", "Ornithology", "Parker's Mood", "Quasimodo", "Relaxin' At Camarillo",
  "Salt Peanuts", "Scrapple From The Apple", "Shaw 'Nuff", "Star Eyes", "Yardbird Suite",
  "A Night In Tunisia", "Bebop", "Con Alma", "Manteca", "Woody 'n' You",
  "Dance Of The Infidels", "Bouncing With Bud", "Un Poco Loco", "Tempus Fugit",
  "Hallucinations", "Celia", "Parisian Thoroughfare",

  // Monk
  "Ask Me Now", "Bemsha Swing", "Blue Monk", "Boo Boo's Birthday", "Brilliant Corners",
  "Bye-Ya", "Coming On The Hudson", "Criss Cross", "Epistrophy", "Evidence",
  "Four In One", "Friday The 13th", "Green Chimneys", "Hackensack", "I Mean You",
  "In Walked Bud", "Let's Cool One", "Little Rootie Tootie", "Misterioso", "Monk's Dream",
  "Monk's Mood", "Nutty", "Off Minor", "Pannonica", "Played Twice", "Reflections",
  "Rhythm-A-Ning", "Ruby, My Dear", "Skippy", "Straight, No Chaser", "Thelonious",
  "Trinkle, Tinkle", "Well, You Needn't", "We See",

  // Hard bop and soul jazz
  "Along Came Betty", "Blues March", "Bolivia", "Cantaloupe Island", "Chitlins Con Carne",
  "Cool Struttin'", "Dat Dere", "Doodlin'", "Down By The Riverside", "Filthy McNasty",
  "Fried Bananas", "Hi-Fly", "Home Cookin'", "I Remember Clifford", "Jeannine",
  "Jordu", "Killer Joe", "Little Sunflower", "Mercy, Mercy, Mercy", "Midnight Special",
  "Milestones", "Minor Swing", "Moanin'", "Mr. P.C.", "Nica's Dream", "Nutville",
  "One For Daddy-O", "Peace", "Recorda Me", "Road Song", "Room 608", "Sack O' Woe",
  "Señor Blues", "Sidewinder", "Song For My Father", "Soul Station", "Split Kick",
  "St. Thomas", "Stolen Moments", "Strollin'", "The Jody Grind", "The Preacher",
  "The Sermon", "The Turnaround", "This I Dig Of You", "Tune Up", "Ugetsu",
  "Unit Seven", "Whisper Not", "Work Song", "Yes Or No", "Ceora", "Cornbread",
  "Search For The New Land", "Speak No Evil", "Infant Eyes", "Witch Hunt",
  "Dance Cadaverous", "Footprints", "Adam's Apple", "El Toro", "Fee-Fi-Fo-Fum",

  // Modal, post-bop, Miles and Coltrane
  "All Blues", "Blue In Green", "Flamenco Sketches", "Freddie Freeloader", "So What",
  "Nardis", "Solar", "Four", "Half Nelson", "Sid's Ahead", "Straight Life",
  "Seven Steps To Heaven", "E.S.P.", "Iris", "Nefertiti", "Pinocchio", "Circle",
  "Eighty-One", "Country Son", "Bitches Brew", "Shhh / Peaceful",
  "Giant Steps", "Countdown", "Naima", "Syeeda's Song Flute", "Mr. P.C.", "Spiral",
  "Cousin Mary", "Impressions", "Alabama", "Crescent", "Lonnie's Lament",
  "A Love Supreme", "Acknowledgement", "Resolution", "Pursuance", "Psalm",
  "My Favorite Things", "Equinox", "Blue Train", "Moment's Notice", "Lazy Bird",
  "Locomotion", "Central Park West", "After The Rain", "Village Blues",

  // Mingus, Silver, Hancock, Shorter, Corea, Jarrett, Metheny
  "Better Git It In Your Soul", "Fables Of Faubus", "Goodbye Pork Pie Hat",
  "Haitian Fight Song", "Boogie Stop Shuffle", "Moanin' (Mingus)", "Sue's Changes",
  "Nostalgia In Times Square", "Peggy's Blue Skylight", "Reincarnation Of A Lovebird",
  "Maiden Voyage", "Dolphin Dance", "The Eye Of The Hurricane", "One Finger Snap",
  "Oliloqui Valley", "Watermelon Man", "Chameleon", "Actual Proof", "Butterfly",
  "Speak Like A Child", "Riot", "Tell Me A Bedtime Story",
  "Spain", "La Fiesta", "Windows", "Litha", "Matrix", "Steps", "500 Miles High",
  "Crystal Silence", "Armando's Rhumba",
  "The Köln Concert", "My Song", "Country", "Long As You Know You're Living Yours",
  "Bright Size Life", "Question And Answer", "Lonely Woman (Metheny)", "Last Train Home",
  "James", "Are You Going With Me?", "First Circle",
  "Birdland", "A Remark You Made", "Teen Town", "Palladium", "Havona", "Portrait Of Tracy",
  "Donna Lee (Pastorius)", "Black Market", "Elegant People",

  // Free and avant-garde
  "Lonely Woman", "Ramblin'", "Congeniality", "Peace (Coleman)", "Focus On Sanity",
  "Free Jazz", "Broken Shadows", "Blues Connotation", "Turnaround", "The Blessing",
  "Ghosts", "Truth Is Marching In", "Spiritual Unity", "Bells",
  "The Creator Has A Master Plan", "Astral Traveling", "Karma",
  "Point Of Departure", "Black Fire", "Smoke Stack", "Refuge", "Dialogue",
  "Out To Lunch", "Hat And Beard", "Gazzelloni", "Straight Up And Down",

  // Bill Evans, Jim Hall, Wes, Bird with Strings, later repertoire
  "Waltz For Debby", "Peri's Scope", "Very Early", "Turn Out The Stars", "Re: Person I Knew",
  "Time Remembered", "Blue In Green (Evans)", "Israel", "My Man's Gone Now",
  "Four On Six", "West Coast Blues", "D-Natural Blues", "Full House", "Twisted Blues",
  "Blues For Pablo", "The Duke", "Boplicity", "Israel (Birth Of The Cool)", "Moon Dreams",
  "Take Five", "Blue Rondo A La Turk", "Three To Get Ready", "Unsquare Dance",
  "Desafinado", "The Girl From Ipanema", "Corcovado", "Wave", "Triste",
  "Insensatez", "One Note Samba", "Chega De Saudade", "O Grande Amor",
  "Blue Bossa", "Black Orpheus", "Manha De Carnaval",

  // Blues and roots
  "Backwater Blues", "C Jam Blues", "Freight Trane", "Now See How You Are",
  "Sandu", "Bags' Groove", "Blue 'n' Boogie", "Walkin'", "Two Bass Hit",
  "Django", "Bluesology", "The Golden Striker", "Skating In Central Park",
  "West End Blues", "Potato Head Blues", "Struttin' With Some Barbecue",
  "Weather Bird", "Tight Like This", "Cornet Chop Suey", "Muskrat Ramble",
  "Singin' The Blues", "Riverboat Shuffle", "I'm Coming Virginia", "Jazz Me Blues",
  "One O'Clock Jump", "Jumpin' At The Woodside", "Lester Leaps In", "Taxi War Dance",
  "Sing, Sing, Sing", "Sweet Lorraine", "Honeysuckle Rose", "Ain't Misbehavin'",
  "Tiger Rag", "Dinah", "After You've Gone", "Rose Room", "Seven Come Eleven",
  "Air Mail Special", "Flying Home", "Nuages", "Djangology", "Belleville",

  // Contemporary
  "Black Radio", "Afro Blue", "Butterfly Dreams", "Inner Urge", "Isotope",
  "Serenity", "Black Narcissus", "Punjab", "Shade Of Jade", "Gazelle",
  "Bolivia (Walton)", "Firm Roots", "Mode For Joe", "The Kicker",
  "Passion Dance", "Blues On The Corner", "Contemplation", "Search For Peace",
  "Fly Little Bird Fly", "The Epic", "Change Of The Guard", "Truth",
  "Lift Every Voice And Sing", "Freedom Jazz Dance", "Red Clay", "Straight Life (Hubbard)",
  "Sky Dive", "First Light", "Little Sunflower", "Povo",
];
