package com.photokeeper;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

class ArchitectureTest {

  private static final JavaClasses ALL_CLASSES =
      new ClassFileImporter()
          .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
          .importPackages("com.photokeeper");

  @Test
  void controllersShouldNotDependOnEachOther() {
    ArchRule rule =
        noClasses()
            .that()
            .resideInAPackage("..controller..")
            .should()
            .dependOnClassesThat()
            .resideInAPackage("..controller..");
    rule.check(ALL_CLASSES);
  }

  @Test
  void servicesShouldNotDependOnControllers() {
    ArchRule rule =
        noClasses()
            .that()
            .resideInAPackage("..service..")
            .should()
            .dependOnClassesThat()
            .resideInAPackage("..controller..");
    rule.check(ALL_CLASSES);
  }

  @Test
  void controllersShouldResideInControllerPackage() {
    ArchRule rule =
        classes()
            .that()
            .haveSimpleNameEndingWith("Controller")
            .should()
            .resideInAPackage("..controller..");
    rule.check(ALL_CLASSES);
  }

  @Test
  void servicesShouldResideInServicePackage() {
    ArchRule rule =
        classes()
            .that()
            .haveSimpleNameEndingWith("Service")
            .should()
            .resideInAPackage("..service..");
    rule.check(ALL_CLASSES);
  }
}
