from abc import ABC, abstractmethod

class Animal(ABC):
    @abstractmethod
    def make_sound(self):
        pass

class Dog(Animal):
    def make_sound(self):
        print("Woof!")

class Cat(Animal):
    def make_sound(self):
        print("Meow!")

class AnimalFactory(ABC):
    @abstractmethod
    def create_animal(self):
        pass

class DogFactory(AnimalFactory):
    def create_animal(self):
        return Dog()

class CatFactory(AnimalFactory):
    def create_animal(self):
        return Cat()

def main():
    # Create a dog factory.
    dog_factory = DogFactory()

    # Create a cat factory.
    cat_factory = CatFactory()

    # Create a dog.
    dog = dog_factory.create_animal()

    # Make the dog make a sound.
    dog.make_sound()

    # Create a cat.
    cat = cat_factory.create_animal()

    # Make the cat make a sound.
    cat.make_sound()

if __name__ == "__main__":
    main()